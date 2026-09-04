//! Shared test-only adapters for golden fixtures not on the public facade.
//!
//! Python, Ruby, and the Go WASI guest expose these as FFI entry points; the
//! argument parsing and core calls live here so the three hosts cannot drift.

#![allow(clippy::missing_docs_in_private_items)]
#![allow(clippy::result_large_err)]

use std::collections::BTreeMap;

use serde_json::{Map, Value};

use crate::envelope::{err_envelope, parse_args_json};
use crate::{
    resolve_authenticated_user, AuthResolutionInput, PaywallGate, SdkError, WebhookError,
    WebhookErrorCode,
};

/// Resolves `resolveAuthenticatedUser` fixture args into a JSON value.
///
/// Auth failures serialize as the success-envelope *value* (the helper-auth
/// corpus asserts `expect.result`, not `expect.error`).
///
/// # Errors
///
/// Returns [`SdkError::Transport`] when required fields are missing or mistyped.
pub fn resolve_authenticated_user_from_json(args_json: &str) -> Result<Value, SdkError> {
    let args: Map<String, Value> = parse_args_json(args_json)?;
    let input = AuthResolutionInput {
        header_user_id: optional_string(&args, "headerUserId")?,
        authorization_header: optional_string(&args, "authorizationHeader")?,
        jwt_secret: optional_string(&args, "jwtSecret")?,
        strict_mode: require_bool(&args, "strictMode")?,
        include_email: require_bool(&args, "includeEmail")?,
        include_name: require_bool(&args, "includeName")?,
        now_unix_secs: match args.get("nowUnixSecs") {
            Some(Value::Number(n)) => n.as_i64().ok_or_else(|| {
                SdkError::transport("args.nowUnixSecs must be an integer".to_owned(), false)
            })?,
            None | Some(Value::Null) => 1_700_000_000,
            Some(_) => {
                return Err(SdkError::transport(
                    "args.nowUnixSecs must be a number".to_owned(),
                    false,
                ));
            }
        },
    };
    match resolve_authenticated_user(&input) {
        Ok(user) => serde_json::to_value(user)
            .map_err(|e| SdkError::transport(format!("serialize failed: {e}"), false)),
        Err(err) => serde_json::to_value(err)
            .map_err(|e| SdkError::transport(format!("serialize failed: {e}"), false)),
    }
}

/// Builds an error envelope for `constructSdkError` fixtures.
///
/// Always returns `{"ok":false,"error":…}` — the error-model corpus never
/// expects a success envelope.
pub fn construct_sdk_error_envelope(args_json: &str) -> String {
    match parse_args_json::<Map<String, Value>>(args_json) {
        Ok(args) => match construct_sdk_error_from_args(&args) {
            Ok(error) => err_envelope(&error),
            Err(message) => err_envelope(&SdkError::transport(message, false)),
        },
        Err(err) => err_envelope(&SdkError::transport(
            format!("parse args: {}", err.message()),
            false,
        )),
    }
}

fn construct_sdk_error_from_args(args: &Map<String, Value>) -> Result<SdkError, String> {
    let kind = require_str(args, "kind")?;
    match kind.as_str() {
        "Api" => build_api(args),
        "Webhook" => build_webhook(args),
        "Paywall" => build_paywall(args),
        "Transport" => build_transport(args),
        other => Err(format!(
            "args.kind must be Api|Webhook|Paywall|Transport, got {other:?}"
        )),
    }
}

fn build_api(args: &Map<String, Value>) -> Result<SdkError, String> {
    let template = require_str(args, "template")?;
    let vars = parse_vars(args.get("vars"))?;
    let status = optional_u16(args, "status")?;
    let code = optional_string_val(args, "code")?;
    let var_refs: BTreeMap<&str, &str> =
        vars.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
    Ok(SdkError::api_from_template(
        &template, &var_refs, status, code,
    ))
}

fn build_webhook(args: &Map<String, Value>) -> Result<SdkError, String> {
    let code_str = require_str(args, "code")?;
    let code = parse_webhook_code(&code_str)?;
    Ok(SdkError::from(WebhookError::new(code)))
}

fn build_paywall(args: &Map<String, Value>) -> Result<SdkError, String> {
    let message = require_str(args, "message")?;
    let gate_val = args
        .get("gate")
        .ok_or_else(|| "args.gate is required for Paywall".to_owned())?;
    let gate: PaywallGate =
        serde_json::from_value(gate_val.clone()).map_err(|e| format!("invalid args.gate: {e}"))?;
    Ok(SdkError::paywall(message, gate))
}

fn build_transport(args: &Map<String, Value>) -> Result<SdkError, String> {
    let message = require_str(args, "message")?;
    let retryable = match args.get("retryable") {
        Some(Value::Bool(b)) => *b,
        None | Some(Value::Null) => {
            return Err("args.retryable is required for Transport".to_owned());
        }
        Some(_) => return Err("args.retryable must be a boolean".to_owned()),
    };
    Ok(SdkError::transport(message, retryable))
}

fn parse_webhook_code(code: &str) -> Result<WebhookErrorCode, String> {
    match code {
        "invalid_signature" => Ok(WebhookErrorCode::InvalidSignature),
        "timestamp_too_old" => Ok(WebhookErrorCode::TimestampTooOld),
        "malformed_signature" => Ok(WebhookErrorCode::MalformedSignature),
        "missing_signature" => Ok(WebhookErrorCode::MissingSignature),
        "invalid_payload" => Ok(WebhookErrorCode::InvalidPayload),
        other => Err(format!("unknown webhook code: {other}")),
    }
}

fn parse_vars(value: Option<&Value>) -> Result<BTreeMap<String, String>, String> {
    match value {
        None | Some(Value::Null) => Ok(BTreeMap::new()),
        Some(Value::Object(map)) => {
            let mut out = BTreeMap::new();
            for (key, val) in map {
                match val {
                    Value::String(s) => {
                        out.insert(key.clone(), s.clone());
                    }
                    Value::Number(n) => {
                        out.insert(key.clone(), n.to_string());
                    }
                    _ => {
                        return Err(format!("args.vars.{key} must be a string or number"));
                    }
                }
            }
            Ok(out)
        }
        Some(_) => Err("args.vars must be an object".to_owned()),
    }
}

fn require_str(args: &Map<String, Value>, key: &str) -> Result<String, String> {
    match args.get(key) {
        Some(Value::String(s)) => Ok(s.clone()),
        _ => Err(format!("args.{key} must be a string")),
    }
}

fn optional_string_val(args: &Map<String, Value>, key: &str) -> Result<Option<String>, String> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.clone())),
        Some(_) => Err(format!("args.{key} must be a string")),
    }
}

fn optional_u16(args: &Map<String, Value>, key: &str) -> Result<Option<u16>, String> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(n)) => n
            .as_u64()
            .and_then(|v| u16::try_from(v).ok())
            .map(Some)
            .ok_or_else(|| format!("args.{key} must be a u16")),
        Some(_) => Err(format!("args.{key} must be a number")),
    }
}

fn optional_string(args: &Map<String, Value>, key: &str) -> Result<Option<String>, SdkError> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.clone())),
        Some(_) => Err(SdkError::transport(
            format!("args.{key} must be a string or null"),
            false,
        )),
    }
}

fn require_bool(args: &Map<String, Value>, key: &str) -> Result<bool, SdkError> {
    match args.get(key) {
        Some(Value::Bool(b)) => Ok(*b),
        _ => Err(SdkError::transport(
            format!("args.{key} must be a boolean"),
            false,
        )),
    }
}

#[cfg(test)]
mod tests {
    #![allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::missing_docs_in_private_items
    )]

    use super::{construct_sdk_error_envelope, resolve_authenticated_user_from_json};
    use serde_json::{json, Value};

    #[test]
    fn header_only_auth_uses_default_clock() {
        let value = resolve_authenticated_user_from_json(
            r#"{"headerUserId":"middleware-user","includeEmail":true,"includeName":true,"strictMode":false}"#,
        )
        .expect("header-only args");
        assert_eq!(
            value,
            json!({
                "userId": "middleware-user",
                "email": Value::Null,
                "name": Value::Null
            })
        );
    }

    #[test]
    fn transport_construct_is_always_an_error_envelope() {
        let envelope = construct_sdk_error_envelope(
            r#"{"kind":"Transport","message":"TLS handshake failed","retryable":false}"#,
        );
        let parsed: Value = serde_json::from_str(&envelope).expect("json");
        assert_eq!(parsed["ok"], json!(false));
        assert_eq!(parsed["error"]["kind"], json!("Transport"));
        assert_eq!(parsed["error"]["message"], json!("TLS handshake failed"));
    }
}
