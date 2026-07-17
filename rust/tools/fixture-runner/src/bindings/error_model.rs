//! Host-side `constructSdkError` fixture adapter (Step 17).
//!
//! Builds [`SdkError`] variants from fixture args and maps them through the
//! single §6.4 conversion helper.

use std::collections::BTreeMap;

use serde_json::Value;
use solvapay_core::{PaywallGate, SdkError, WebhookError, WebhookErrorCode};

use crate::model::FixtureInput;
use crate::runner::BindingError;
use crate::sdk_error::sdk_error_to_observation;

/// Binding for `constructSdkError`.
///
/// Always returns [`BindingError::Sdk`] with the constructed observation (fixtures
/// under `error-model/` expect errors, never success).
///
/// # Arguments
///
/// * `input` - Fixture input with `args.kind` and kind-specific fields.
///
/// # Errors
///
/// - [`BindingError::Harness`] when args are missing or malformed
/// - [`BindingError::Sdk`] with the constructed [`SdkError`] observation
pub(super) fn invoke_construct_sdk_error(input: &FixtureInput) -> Result<Value, BindingError> {
    let error = build_sdk_error(&input.args)?;
    Err(BindingError::Sdk(sdk_error_to_observation(error)))
}

/// Builds an [`SdkError`] from fixture args.
///
/// # Errors
///
/// Returns [`BindingError::Harness`] when required fields are missing/invalid.
fn build_sdk_error(args: &BTreeMap<String, Value>) -> Result<SdkError, BindingError> {
    let kind = require_arg_str(args, "kind")?;
    match kind {
        "Api" => build_api(args),
        "Webhook" => build_webhook(args),
        "Paywall" => build_paywall(args),
        "Transport" => build_transport(args),
        other => Err(BindingError::Harness(format!(
            "args.kind must be Api|Webhook|Paywall|Transport, got {other:?}"
        ))),
    }
}

/// Builds [`SdkError::Api`] from template + vars (+ optional status/code).
///
/// # Errors
///
/// Returns [`BindingError::Harness`] when template/vars are invalid.
fn build_api(args: &BTreeMap<String, Value>) -> Result<SdkError, BindingError> {
    let template = require_arg_str(args, "template")?;
    let vars = parse_vars(args.get("vars"))?;
    let status = optional_u16(args, "status")?;
    let code = optional_string(args, "code")?;
    let var_refs: BTreeMap<&str, &str> =
        vars.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
    Ok(SdkError::api_from_template(
        template, &var_refs, status, code,
    ))
}

/// Builds [`SdkError::Webhook`] from a stable webhook code.
///
/// # Errors
///
/// Returns [`BindingError::Harness`] when the code is missing or unknown.
fn build_webhook(args: &BTreeMap<String, Value>) -> Result<SdkError, BindingError> {
    let code_str = require_arg_str(args, "code")?;
    let code = parse_webhook_code(code_str)?;
    Ok(SdkError::from(WebhookError::new(code)))
}

/// Builds [`SdkError::Paywall`] from throw message + gate JSON.
///
/// # Errors
///
/// Returns [`BindingError::Harness`] when message/gate are missing or invalid.
fn build_paywall(args: &BTreeMap<String, Value>) -> Result<SdkError, BindingError> {
    let message = require_arg_str(args, "message")?.to_owned();
    let gate_val = args
        .get("gate")
        .ok_or_else(|| BindingError::Harness("args.gate is required for Paywall".to_owned()))?;
    let gate: PaywallGate = serde_json::from_value(gate_val.clone())
        .map_err(|e| BindingError::Harness(format!("invalid PaywallGate: {e}")))?;
    Ok(SdkError::paywall(message, gate))
}

/// Builds [`SdkError::Transport`] from message + retryable flag.
///
/// # Errors
///
/// Returns [`BindingError::Harness`] when message/retryable are missing or invalid.
fn build_transport(args: &BTreeMap<String, Value>) -> Result<SdkError, BindingError> {
    let message = require_arg_str(args, "message")?.to_owned();
    let retryable = match args.get("retryable") {
        Some(Value::Bool(b)) => *b,
        Some(_) => {
            return Err(BindingError::Harness(
                "args.retryable must be a boolean".to_owned(),
            ))
        }
        None => {
            return Err(BindingError::Harness(
                "args.retryable is required for Transport".to_owned(),
            ))
        }
    };
    Ok(SdkError::transport(message, retryable))
}

/// Parses a snake_case webhook error code string.
///
/// # Errors
///
/// Returns [`BindingError::Harness`] for unknown codes.
fn parse_webhook_code(code: &str) -> Result<WebhookErrorCode, BindingError> {
    match code {
        "missing_signature" => Ok(WebhookErrorCode::MissingSignature),
        "malformed_signature" => Ok(WebhookErrorCode::MalformedSignature),
        "timestamp_too_old" => Ok(WebhookErrorCode::TimestampTooOld),
        "invalid_signature" => Ok(WebhookErrorCode::InvalidSignature),
        "invalid_payload" => Ok(WebhookErrorCode::InvalidPayload),
        other => Err(BindingError::Harness(format!(
            "unknown webhook code: {other}"
        ))),
    }
}

/// Parses `args.vars` into string substitutions for template rendering.
///
/// # Errors
///
/// Returns [`BindingError::Harness`] when the value is not an object of strings/numbers.
fn parse_vars(value: Option<&Value>) -> Result<BTreeMap<String, String>, BindingError> {
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
                        return Err(BindingError::Harness(format!(
                            "args.vars.{key} must be a string or number"
                        )))
                    }
                }
            }
            Ok(out)
        }
        Some(_) => Err(BindingError::Harness(
            "args.vars must be an object".to_owned(),
        )),
    }
}

/// Reads a required string argument from the args map.
///
/// # Errors
///
/// Returns [`BindingError::Harness`] when missing or not a string.
fn require_arg_str<'a>(
    args: &'a BTreeMap<String, Value>,
    key: &str,
) -> Result<&'a str, BindingError> {
    match args.get(key) {
        Some(Value::String(s)) => Ok(s.as_str()),
        Some(_) => Err(BindingError::Harness(format!(
            "args.{key} must be a string"
        ))),
        None => Err(BindingError::Harness(format!("args.{key} is required"))),
    }
}

/// Reads an optional string argument (`null` / absent → `None`).
///
/// # Errors
///
/// Returns [`BindingError::Harness`] when the value is neither string nor null.
fn optional_string(
    args: &BTreeMap<String, Value>,
    key: &str,
) -> Result<Option<String>, BindingError> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.clone())),
        Some(_) => Err(BindingError::Harness(format!(
            "args.{key} must be a string or null"
        ))),
    }
}

/// Reads an optional `u16` argument (`null` / absent → `None`).
///
/// # Errors
///
/// Returns [`BindingError::Harness`] when the value is not a fitting number.
fn optional_u16(args: &BTreeMap<String, Value>, key: &str) -> Result<Option<u16>, BindingError> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(n)) => {
            let v = n
                .as_u64()
                .ok_or_else(|| BindingError::Harness(format!("args.{key} must be a u16")))?;
            u16::try_from(v)
                .map(Some)
                .map_err(|_| BindingError::Harness(format!("args.{key} must be a u16")))
        }
        Some(_) => Err(BindingError::Harness(format!(
            "args.{key} must be a number or null"
        ))),
    }
}
