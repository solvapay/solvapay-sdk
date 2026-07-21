//! Shared JSON-args parsers for sync wasm-bindgen envelope bindings (Step 38R).
//!
//! Adapted from `rust/bindings/node/src/args.rs` with no napi dependency —
//! uses the local [`crate::error::parse_args_json`]. Helpers unused by a given
//! profile (edge vs browser) are tolerated.

#![allow(dead_code)]

use serde::Serialize;
use serde_json::{Map, Value};
use solvapay_core::{HelperErrorResult, SdkError};

use crate::error::parse_args_json;

/// Parses args JSON into an object map.
pub(crate) fn args_map(args_json: &str) -> Result<Map<String, Value>, SdkError> {
    parse_args_json(args_json)
}

/// Serializes `value` to JSON, mapping failures to Transport.
pub(crate) fn to_value<T: Serialize>(value: &T) -> Result<Value, SdkError> {
    serde_json::to_value(value)
        .map_err(|err| SdkError::transport(format!("serialize failed: {err}"), false))
}

/// `Option<HelperErrorResult>` → `null` or serialized error (fixture parity).
pub(crate) fn option_helper_err(opt: Option<HelperErrorResult>) -> Result<Value, SdkError> {
    match opt {
        None => Ok(Value::Null),
        Some(err) => to_value(&err),
    }
}

/// `Result<T, HelperErrorResult>` → Ok or Err as the envelope **value**.
pub(crate) fn result_as_value<T: Serialize>(
    result: Result<T, HelperErrorResult>,
) -> Result<Value, SdkError> {
    match result {
        Ok(value) => to_value(&value),
        Err(err) => to_value(&err),
    }
}

/// Reads a required string arg.
pub(crate) fn require_string(args: &Map<String, Value>, key: &str) -> Result<String, SdkError> {
    match args.get(key) {
        Some(Value::String(s)) => Ok(s.clone()),
        Some(_) => Err(SdkError::transport(
            format!("args.{key} must be a string"),
            false,
        )),
        None => Err(SdkError::transport(
            format!("args.{key} is required"),
            false,
        )),
    }
}

/// Reads an optional string arg (`null`/absent → `None`).
pub(crate) fn optional_string(
    args: &Map<String, Value>,
    key: &str,
) -> Result<Option<String>, SdkError> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.clone())),
        Some(_) => Err(SdkError::transport(
            format!("args.{key} must be a string or null"),
            false,
        )),
    }
}

/// Reads a required boolean arg.
pub(crate) fn require_bool(args: &Map<String, Value>, key: &str) -> Result<bool, SdkError> {
    match args.get(key) {
        Some(Value::Bool(b)) => Ok(*b),
        Some(_) => Err(SdkError::transport(
            format!("args.{key} must be a boolean"),
            false,
        )),
        None => Err(SdkError::transport(
            format!("args.{key} is required"),
            false,
        )),
    }
}

/// Reads a required f64 arg.
pub(crate) fn require_f64(args: &Map<String, Value>, key: &str) -> Result<f64, SdkError> {
    match args.get(key) {
        Some(Value::Number(n)) => n.as_f64().ok_or_else(|| {
            SdkError::transport(format!("args.{key} must be a finite number"), false)
        }),
        Some(_) => Err(SdkError::transport(
            format!("args.{key} must be a number"),
            false,
        )),
        None => Err(SdkError::transport(
            format!("args.{key} is required"),
            false,
        )),
    }
}

/// Reads an optional f64 arg (`null`/absent → `None`).
pub(crate) fn optional_f64(args: &Map<String, Value>, key: &str) -> Result<Option<f64>, SdkError> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(n)) => n.as_f64().map(Some).ok_or_else(|| {
            SdkError::transport(format!("args.{key} must be a finite number"), false)
        }),
        Some(_) => Err(SdkError::transport(
            format!("args.{key} must be a number or null"),
            false,
        )),
    }
}

/// Reads a required i64 arg.
pub(crate) fn require_i64(args: &Map<String, Value>, key: &str) -> Result<i64, SdkError> {
    match args.get(key) {
        Some(Value::Number(n)) => n
            .as_i64()
            .ok_or_else(|| SdkError::transport(format!("args.{key} must be an integer"), false)),
        Some(_) => Err(SdkError::transport(
            format!("args.{key} must be a number"),
            false,
        )),
        None => Err(SdkError::transport(
            format!("args.{key} is required"),
            false,
        )),
    }
}

/// Reads a required u32 arg.
pub(crate) fn require_u32(args: &Map<String, Value>, key: &str) -> Result<u32, SdkError> {
    match args.get(key) {
        Some(Value::Number(n)) => n
            .as_u64()
            .and_then(|v| u32::try_from(v).ok())
            .ok_or_else(|| SdkError::transport(format!("args.{key} must be a u32"), false)),
        Some(_) => Err(SdkError::transport(
            format!("args.{key} must be a number"),
            false,
        )),
        None => Err(SdkError::transport(
            format!("args.{key} is required"),
            false,
        )),
    }
}

/// Reads an optional u32 arg (`null`/absent → `None`).
pub(crate) fn optional_u32(args: &Map<String, Value>, key: &str) -> Result<Option<u32>, SdkError> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(n)) => n
            .as_u64()
            .and_then(|v| u32::try_from(v).ok())
            .map(Some)
            .ok_or_else(|| SdkError::transport(format!("args.{key} must be a u32"), false)),
        Some(_) => Err(SdkError::transport(
            format!("args.{key} must be a number or null"),
            false,
        )),
    }
}

/// Reads an optional u64 arg (`null`/absent → `None`).
pub(crate) fn optional_u64(args: &Map<String, Value>, key: &str) -> Result<Option<u64>, SdkError> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(n)) => n
            .as_u64()
            .map(Some)
            .ok_or_else(|| SdkError::transport(format!("args.{key} must be a u64"), false)),
        Some(_) => Err(SdkError::transport(
            format!("args.{key} must be a number or null"),
            false,
        )),
    }
}

/// Reads an optional u16 arg (`null`/absent → `None`).
pub(crate) fn optional_u16(args: &Map<String, Value>, key: &str) -> Result<Option<u16>, SdkError> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(n)) => n
            .as_u64()
            .and_then(|v| u16::try_from(v).ok())
            .map(Some)
            .ok_or_else(|| SdkError::transport(format!("args.{key} must be a u16"), false)),
        Some(_) => Err(SdkError::transport(
            format!("args.{key} must be a number or null"),
            false,
        )),
    }
}

/// Reads a required object arg as a map reference.
pub(crate) fn require_object<'a>(
    args: &'a Map<String, Value>,
    key: &str,
) -> Result<&'a Map<String, Value>, SdkError> {
    match args.get(key) {
        Some(Value::Object(map)) => Ok(map),
        Some(_) | None => Err(SdkError::transport(
            format!("args.{key} must be an object"),
            false,
        )),
    }
}

/// Reads a required array arg.
pub(crate) fn require_array<'a>(
    args: &'a Map<String, Value>,
    key: &str,
) -> Result<&'a [Value], SdkError> {
    match args.get(key) {
        Some(Value::Array(arr)) => Ok(arr.as_slice()),
        Some(_) | None => Err(SdkError::transport(
            format!("args.{key} must be an array"),
            false,
        )),
    }
}

/// Optional raw JSON value (`null`/absent → `None`).
pub(crate) fn optional_value(args: &Map<String, Value>, key: &str) -> Option<Value> {
    match args.get(key) {
        None | Some(Value::Null) => None,
        Some(value) => Some(value.clone()),
    }
}

/// Deserializes a required typed arg.
pub(crate) fn require_typed<T: serde::de::DeserializeOwned>(
    args: &Map<String, Value>,
    key: &str,
) -> Result<T, SdkError> {
    let value = args
        .get(key)
        .ok_or_else(|| SdkError::transport(format!("args.{key} is required"), false))?;
    serde_json::from_value(value.clone())
        .map_err(|err| SdkError::transport(format!("invalid args.{key}: {err}"), false))
}

/// Deserializes an optional typed arg (`null`/absent → `None`).
pub(crate) fn optional_typed<T: serde::de::DeserializeOwned>(
    args: &Map<String, Value>,
    key: &str,
) -> Result<Option<T>, SdkError> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => serde_json::from_value(value.clone())
            .map(Some)
            .map_err(|err| SdkError::transport(format!("invalid args.{key}: {err}"), false)),
    }
}
