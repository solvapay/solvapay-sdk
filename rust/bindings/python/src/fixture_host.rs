//! Test-only host adapters for golden fixtures not on the public facade (Step 42).
//!
//! Exposes `_resolve_authenticated_user` and `_construct_sdk_error` for the
//! offline Python contract suite. Not part of the idiomatic `solvapay` facade.

#![allow(clippy::missing_docs_in_private_items)]

use std::collections::BTreeMap;

use pyo3::prelude::*;
use serde_json::{Map, Value};
use solvapay_core::{
    resolve_authenticated_user, AuthResolutionInput, PaywallGate, SdkError, WebhookError,
    WebhookErrorCode,
};

use crate::error::{err_envelope, parse_args_json, run_envelope_sync};

/// Binding for `resolveAuthenticatedUser` (helper-auth fixtures).
#[pyfunction(name = "_resolve_authenticated_user")]
pub fn resolve_authenticated_user_binding(args_json: String) -> String {
    run_envelope_sync(|| {
        let args: Map<String, Value> = parse_args_json(&args_json)?;
        let header_user_id = optional_string(&args, "headerUserId")?;
        let authorization_header = optional_string(&args, "authorizationHeader")?;
        let jwt_secret = optional_string(&args, "jwtSecret")?;
        let strict_mode = require_bool(&args, "strictMode")?;
        let include_email = require_bool(&args, "includeEmail")?;
        let include_name = require_bool(&args, "includeName")?;
        let now_unix_secs = match args.get("nowUnixSecs") {
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
            Ok(user) => serde_json::to_value(user)
                .map_err(|e| SdkError::transport(format!("serialize failed: {e}"), false)),
            Err(err) => serde_json::to_value(err)
                .map_err(|e| SdkError::transport(format!("serialize failed: {e}"), false)),
        }
    })
}

/// Binding for `constructSdkError` (error-model fixtures).
///
/// Always returns an error envelope (fixtures under `error-model/` expect errors).
#[pyfunction(name = "_construct_sdk_error")]
pub fn construct_sdk_error_binding(args_json: String) -> String {
    match build_sdk_error_from_args(&args_json) {
        Ok(error) => err_envelope(&error),
        Err(message) => err_envelope(&SdkError::transport(message, false)),
    }
}

fn build_sdk_error_from_args(args_json: &str) -> Result<SdkError, String> {
    let args: Map<String, Value> =
        parse_args_json(args_json).map_err(|e| format!("parse args: {}", e.message()))?;
    let kind = require_str(&args, "kind")?;
    match kind.as_str() {
        "Api" => build_api(&args),
        "Webhook" => build_webhook(&args),
        "Paywall" => build_paywall(&args),
        "Transport" => build_transport(&args),
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

/// Registers test-only fixture host helpers on the extension module.
pub(crate) fn register(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(resolve_authenticated_user_binding, m)?)?;
    m.add_function(wrap_pyfunction!(construct_sdk_error_binding, m)?)?;
    Ok(())
}
