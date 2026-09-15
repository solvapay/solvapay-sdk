//! Host-side adapter for `validatePublicBaseUrl` (string result → fixture error).

use serde_json::Value;
use solvapay_core::validate_public_base_url;

use crate::model::FixtureInput;
use crate::runner::{require_string_arg, BindingError, ErrorObservation};

/// Binding for `validatePublicBaseUrl` — invalid URLs surface as SDK errors.
pub(crate) fn invoke_validate_public_base_url(input: &FixtureInput) -> Result<Value, BindingError> {
    let public_base_url = require_string_arg(input, "publicBaseUrl")?;
    match validate_public_base_url(&public_base_url) {
        None => Ok(Value::Null),
        Some(message) => Err(BindingError::Sdk(ErrorObservation {
            name: Some("Error".to_owned()),
            message: message.to_owned(),
            kind: None,
            code: None,
            status: None,
        })),
    }
}
