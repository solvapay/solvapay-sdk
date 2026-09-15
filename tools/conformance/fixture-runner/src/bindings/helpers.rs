//! Host-clock injection for `resolveAuthenticatedUser` (not derivable from IR).

use serde_json::Value;
use solvapay_core::{resolve_authenticated_user, AuthResolutionInput};

use super::webhook::parse_iso8601_utc_to_unix_secs;
use crate::model::FixtureInput;
use crate::runner::BindingError;

/// Binding for `resolveAuthenticatedUser`.
///
/// # Arguments
///
/// * `input` - Fixture args: header/bearer/secret/flags; optional `clock` on input.
///
/// # Returns
///
/// Authenticated user JSON or helper error JSON (`expect.result` shape).
///
/// # Errors
///
/// Returns [`BindingError::Harness`] when args are invalid.
pub fn invoke_resolve_authenticated_user(input: &FixtureInput) -> Result<Value, BindingError> {
    let header_user_id = optional_string_arg(input, "headerUserId")?;
    let authorization_header = optional_string_arg(input, "authorizationHeader")?;
    let jwt_secret = optional_string_arg(input, "jwtSecret")?;
    let strict_mode = require_bool_arg(input, "strictMode")?;
    let include_email = require_bool_arg(input, "includeEmail")?;
    let include_name = require_bool_arg(input, "includeName")?;
    let now_unix_secs = match &input.clock {
        Some(clock) => parse_iso8601_utc_to_unix_secs(clock).ok_or_else(|| {
            BindingError::Harness(format!(
                "input.clock must be YYYY-MM-DDTHH:MM:SSZ, got {clock:?}"
            ))
        })?,
        None => 1_700_000_000,
    };

    let resolved = resolve_authenticated_user(&AuthResolutionInput {
        header_user_id,
        authorization_header,
        jwt_secret,
        strict_mode,
        include_email,
        include_name,
        now_unix_secs,
    });

    match resolved {
        Ok(user) => serde_json::to_value(user).map_err(|e| BindingError::Harness(e.to_string())),
        Err(err) => serde_json::to_value(err).map_err(|e| BindingError::Harness(e.to_string())),
    }
}

fn optional_string_arg(input: &FixtureInput, key: &str) -> Result<Option<String>, BindingError> {
    match input.args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.clone())),
        Some(_) => Err(BindingError::Harness(format!(
            "args.{key} must be a string or null"
        ))),
    }
}

fn require_bool_arg(input: &FixtureInput, key: &str) -> Result<bool, BindingError> {
    match input.args.get(key) {
        Some(Value::Bool(b)) => Ok(*b),
        Some(_) => Err(BindingError::Harness(format!(
            "args.{key} must be a boolean"
        ))),
        None => Err(BindingError::Harness(format!("args.{key} is required"))),
    }
}
