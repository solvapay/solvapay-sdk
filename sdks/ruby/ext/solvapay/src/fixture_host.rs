//! Test-only native seams for shared offline fixture replay.

#![allow(clippy::missing_docs_in_private_items)]

use std::collections::BTreeMap;

use magnus::prelude::*;
use magnus::{function, Error, RModule};
use serde_json::{Map, Value};
use solvapay_core::{
    resolve_authenticated_user, AuthResolutionInput, PaywallGate, SdkError, WebhookError,
    WebhookErrorCode,
};

use crate::error::{err_envelope, parse_args_json, run_envelope_sync};

pub(crate) fn resolve_authenticated_user_binding(args_json: String) -> String {
    run_envelope_sync(|| {
        let args: Map<String, Value> = parse_args_json(&args_json)?;
        let input = AuthResolutionInput {
            header_user_id: optional_string(&args, "headerUserId")?,
            authorization_header: optional_string(&args, "authorizationHeader")?,
            jwt_secret: optional_string(&args, "jwtSecret")?,
            strict_mode: require_bool(&args, "strictMode")?,
            include_email: require_bool(&args, "includeEmail")?,
            include_name: require_bool(&args, "includeName")?,
            now_unix_secs: optional_i64(&args, "nowUnixSecs")?.unwrap_or(1_700_000_000),
        };
        match resolve_authenticated_user(&input) {
            Ok(user) => serde_json::to_value(user),
            Err(error) => serde_json::to_value(error),
        }
        .map_err(|error| SdkError::transport(format!("serialize failed: {error}"), false))
    })
}

pub(crate) fn construct_sdk_error_binding(args_json: String) -> String {
    match build_sdk_error(&args_json) {
        Ok(error) => err_envelope(&error),
        Err(message) => err_envelope(&SdkError::transport(message, false)),
    }
}

fn build_sdk_error(args_json: &str) -> Result<SdkError, String> {
    let args: Map<String, Value> =
        parse_args_json(args_json).map_err(|error| format!("parse args: {}", error.message()))?;
    match require_str(&args, "kind")?.as_str() {
        "Api" => {
            let template = require_str(&args, "template")?;
            let vars = parse_vars(args.get("vars"))?;
            let refs: BTreeMap<&str, &str> = vars
                .iter()
                .map(|(key, value)| (key.as_str(), value.as_str()))
                .collect();
            Ok(SdkError::api_from_template(
                &template,
                &refs,
                optional_u16(&args, "status")?,
                optional_string_value(&args, "code")?,
            ))
        }
        "Webhook" => Ok(SdkError::from(WebhookError::new(parse_webhook_code(
            &require_str(&args, "code")?,
        )?))),
        "Paywall" => {
            let message = require_str(&args, "message")?;
            let gate: PaywallGate = serde_json::from_value(
                args.get("gate")
                    .ok_or_else(|| "args.gate is required for Paywall".to_owned())?
                    .clone(),
            )
            .map_err(|error| format!("invalid args.gate: {error}"))?;
            Ok(SdkError::paywall(message, gate))
        }
        "Transport" => {
            let message = require_str(&args, "message")?;
            let retryable = args
                .get("retryable")
                .and_then(Value::as_bool)
                .ok_or_else(|| "args.retryable must be a boolean".to_owned())?;
            Ok(SdkError::transport(message, retryable))
        }
        other => Err(format!(
            "args.kind must be Api|Webhook|Paywall|Transport, got {other:?}"
        )),
    }
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
        Some(Value::Object(map)) => map
            .iter()
            .map(|(key, value)| match value {
                Value::String(value) => Ok((key.clone(), value.clone())),
                Value::Number(value) => Ok((key.clone(), value.to_string())),
                _ => Err(format!("args.vars.{key} must be a string or number")),
            })
            .collect(),
        Some(_) => Err("args.vars must be an object".to_owned()),
    }
}

fn require_str(args: &Map<String, Value>, key: &str) -> Result<String, String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| format!("args.{key} must be a string"))
}

fn optional_string_value(args: &Map<String, Value>, key: &str) -> Result<Option<String>, String> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        Some(_) => Err(format!("args.{key} must be a string")),
    }
}

fn optional_u16(args: &Map<String, Value>, key: &str) -> Result<Option<u16>, String> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(value)) => value
            .as_u64()
            .and_then(|value| u16::try_from(value).ok())
            .map(Some)
            .ok_or_else(|| format!("args.{key} must be a u16")),
        Some(_) => Err(format!("args.{key} must be a number")),
    }
}

fn optional_string(args: &Map<String, Value>, key: &str) -> Result<Option<String>, SdkError> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        Some(_) => Err(SdkError::transport(
            format!("args.{key} must be a string or null"),
            false,
        )),
    }
}

fn require_bool(args: &Map<String, Value>, key: &str) -> Result<bool, SdkError> {
    args.get(key)
        .and_then(Value::as_bool)
        .ok_or_else(|| SdkError::transport(format!("args.{key} must be a boolean"), false))
}

fn optional_i64(args: &Map<String, Value>, key: &str) -> Result<Option<i64>, SdkError> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(value)) => value
            .as_i64()
            .map(Some)
            .ok_or_else(|| SdkError::transport(format!("args.{key} must be an integer"), false)),
        Some(_) => Err(SdkError::transport(
            format!("args.{key} must be a number"),
            false,
        )),
    }
}

pub(crate) fn register(native: RModule) -> Result<(), Error> {
    native.define_singleton_method(
        "_resolve_authenticated_user",
        function!(resolve_authenticated_user_binding, 1),
    )?;
    native.define_singleton_method(
        "_construct_sdk_error",
        function!(construct_sdk_error_binding, 1),
    )?;
    Ok(())
}
