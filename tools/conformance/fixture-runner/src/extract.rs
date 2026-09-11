//! BindingError-flavored JSON-arg extractors for generated fixture-runner
//! invoke bodies. Names and arities match the napi `args.rs` helpers.

use serde::Serialize;
use serde_json::{Map, Value};
use solvapay_core::HelperErrorResult;

use crate::model::FixtureInput;
use crate::runner::BindingError;

/// Copies fixture `input.args` into a serde_json object map.
pub fn args_map(input: &FixtureInput) -> Map<String, Value> {
    input
        .args
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect()
}

/// Serializes `value` to JSON, mapping failures to a harness error.
pub fn to_value<T: Serialize>(value: &T) -> Result<Value, BindingError> {
    serde_json::to_value(value)
        .map_err(|err| BindingError::Harness(format!("serialize failed: {err}")))
}

/// `Option<HelperErrorResult>` → `null` or serialized error (fixture parity).
pub fn option_helper_err(opt: Option<HelperErrorResult>) -> Result<Value, BindingError> {
    match opt {
        None => Ok(Value::Null),
        Some(err) => to_value(&err),
    }
}

/// `Result<T, HelperErrorResult>` → Ok or Err as the fixture **value**.
pub fn result_as_value<T: Serialize>(
    result: Result<T, HelperErrorResult>,
) -> Result<Value, BindingError> {
    match result {
        Ok(value) => to_value(&value),
        Err(err) => to_value(&err),
    }
}

/// Reads a required string arg.
pub fn require_string(args: &Map<String, Value>, key: &str) -> Result<String, BindingError> {
    match args.get(key) {
        Some(Value::String(s)) => Ok(s.clone()),
        Some(_) => Err(BindingError::Harness(format!(
            "args.{key} must be a string"
        ))),
        None => Err(BindingError::Harness(format!("args.{key} is required"))),
    }
}

/// Reads an optional string arg (`null`/absent → `None`).
pub fn optional_string(
    args: &Map<String, Value>,
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

/// Reads a required boolean arg.
pub fn require_bool(args: &Map<String, Value>, key: &str) -> Result<bool, BindingError> {
    match args.get(key) {
        Some(Value::Bool(b)) => Ok(*b),
        Some(_) => Err(BindingError::Harness(format!(
            "args.{key} must be a boolean"
        ))),
        None => Err(BindingError::Harness(format!("args.{key} is required"))),
    }
}

/// Reads a required f64 arg.
pub fn require_f64(args: &Map<String, Value>, key: &str) -> Result<f64, BindingError> {
    match args.get(key) {
        Some(Value::Number(n)) => n
            .as_f64()
            .ok_or_else(|| BindingError::Harness(format!("args.{key} must be a finite number"))),
        Some(_) => Err(BindingError::Harness(format!(
            "args.{key} must be a number"
        ))),
        None => Err(BindingError::Harness(format!("args.{key} is required"))),
    }
}

/// Reads an optional f64 arg (`null`/absent → `None`).
pub fn optional_f64(args: &Map<String, Value>, key: &str) -> Result<Option<f64>, BindingError> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(n)) => n
            .as_f64()
            .map(Some)
            .ok_or_else(|| BindingError::Harness(format!("args.{key} must be a finite number"))),
        Some(_) => Err(BindingError::Harness(format!(
            "args.{key} must be a number or null"
        ))),
    }
}

/// Reads a required i64 arg.
pub fn require_i64(args: &Map<String, Value>, key: &str) -> Result<i64, BindingError> {
    match args.get(key) {
        Some(Value::Number(n)) => n
            .as_i64()
            .ok_or_else(|| BindingError::Harness(format!("args.{key} must be an integer"))),
        Some(_) => Err(BindingError::Harness(format!(
            "args.{key} must be a number"
        ))),
        None => Err(BindingError::Harness(format!("args.{key} is required"))),
    }
}

/// Reads a required u32 arg.
pub fn require_u32(args: &Map<String, Value>, key: &str) -> Result<u32, BindingError> {
    match args.get(key) {
        Some(Value::Number(n)) => n
            .as_u64()
            .and_then(|v| u32::try_from(v).ok())
            .ok_or_else(|| BindingError::Harness(format!("args.{key} must be a u32"))),
        Some(_) => Err(BindingError::Harness(format!(
            "args.{key} must be a number"
        ))),
        None => Err(BindingError::Harness(format!("args.{key} is required"))),
    }
}

/// Reads an optional u32 arg (`null`/absent → `None`).
pub fn optional_u32(args: &Map<String, Value>, key: &str) -> Result<Option<u32>, BindingError> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(n)) => n
            .as_u64()
            .and_then(|v| u32::try_from(v).ok())
            .map(Some)
            .ok_or_else(|| BindingError::Harness(format!("args.{key} must be a u32"))),
        Some(_) => Err(BindingError::Harness(format!(
            "args.{key} must be a number or null"
        ))),
    }
}

/// Reads an optional u64 arg (`null`/absent → `None`).
pub fn optional_u64(args: &Map<String, Value>, key: &str) -> Result<Option<u64>, BindingError> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(n)) => n
            .as_u64()
            .map(Some)
            .ok_or_else(|| BindingError::Harness(format!("args.{key} must be a u64"))),
        Some(_) => Err(BindingError::Harness(format!(
            "args.{key} must be a number or null"
        ))),
    }
}

/// Reads an optional u16 arg (`null`/absent → `None`).
pub fn optional_u16(args: &Map<String, Value>, key: &str) -> Result<Option<u16>, BindingError> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(n)) => n
            .as_u64()
            .and_then(|v| u16::try_from(v).ok())
            .map(Some)
            .ok_or_else(|| BindingError::Harness(format!("args.{key} must be a u16"))),
        Some(_) => Err(BindingError::Harness(format!(
            "args.{key} must be a number or null"
        ))),
    }
}

/// Reads a required object arg as a map reference.
pub fn require_object<'a>(
    args: &'a Map<String, Value>,
    key: &str,
) -> Result<&'a Map<String, Value>, BindingError> {
    match args.get(key) {
        Some(Value::Object(map)) => Ok(map),
        Some(_) | None => Err(BindingError::Harness(format!(
            "args.{key} must be an object"
        ))),
    }
}

/// Reads a required array arg.
pub fn require_array<'a>(
    args: &'a Map<String, Value>,
    key: &str,
) -> Result<&'a [Value], BindingError> {
    match args.get(key) {
        Some(Value::Array(arr)) => Ok(arr.as_slice()),
        Some(_) | None => Err(BindingError::Harness(format!(
            "args.{key} must be an array"
        ))),
    }
}

/// Optional raw JSON value (`null`/absent → `None`).
pub fn optional_value(args: &Map<String, Value>, key: &str) -> Option<Value> {
    match args.get(key) {
        None | Some(Value::Null) => None,
        Some(value) => Some(value.clone()),
    }
}

/// Deserializes a required typed arg.
pub fn require_typed<T: serde::de::DeserializeOwned>(
    args: &Map<String, Value>,
    key: &str,
) -> Result<T, BindingError> {
    let value = args
        .get(key)
        .ok_or_else(|| BindingError::Harness(format!("args.{key} is required")))?;
    serde_json::from_value(value.clone())
        .map_err(|err| BindingError::Harness(format!("invalid args.{key}: {err}")))
}

/// Deserializes an optional typed arg (`null`/absent → `None`).
pub fn optional_typed<T: serde::de::DeserializeOwned>(
    args: &Map<String, Value>,
    key: &str,
) -> Result<Option<T>, BindingError> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => serde_json::from_value(value.clone())
            .map(Some)
            .map_err(|err| BindingError::Harness(format!("invalid args.{key}: {err}"))),
    }
}

/// Host-injected millisecond clock from `input.clock`.
pub fn require_clock_ms(input: &FixtureInput) -> Result<i64, BindingError> {
    let clock = input
        .clock
        .as_deref()
        .ok_or_else(|| BindingError::Harness("input.clock is required".to_owned()))?;
    let secs =
        crate::bindings::webhook::parse_iso8601_utc_to_unix_secs(clock).ok_or_else(|| {
            BindingError::Harness(format!(
                "input.clock must be YYYY-MM-DDTHH:MM:SSZ, got {clock:?}"
            ))
        })?;
    Ok(secs.saturating_mul(1000))
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::missing_docs_in_private_items
)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::BTreeMap;

    fn input_with(args: BTreeMap<String, Value>) -> FixtureInput {
        FixtureInput {
            fn_name: "test".into(),
            args,
            clock: None,
            rng_seed: None,
        }
    }

    #[test]
    fn args_map_copies_fixture_args() {
        let mut args = BTreeMap::new();
        args.insert("x".into(), json!("y"));
        let map = args_map(&input_with(args));
        assert_eq!(map.get("x"), Some(&json!("y")));
    }

    #[test]
    fn require_string_ok_and_missing() {
        let mut args = Map::new();
        args.insert("k".into(), json!("v"));
        assert_eq!(require_string(&args, "k").unwrap(), "v");
        assert!(require_string(&args, "missing").is_err());
    }

    #[test]
    fn optional_string_absent_null_and_value() {
        let mut args = Map::new();
        args.insert("n".into(), Value::Null);
        args.insert("s".into(), json!("ok"));
        assert_eq!(optional_string(&args, "missing").unwrap(), None);
        assert_eq!(optional_string(&args, "n").unwrap(), None);
        assert_eq!(optional_string(&args, "s").unwrap(), Some("ok".into()));
    }

    #[test]
    fn require_f64_ok() {
        let mut args = Map::new();
        args.insert("n".into(), json!(1.5));
        assert_eq!(require_f64(&args, "n").unwrap(), 1.5);
    }

    #[test]
    fn require_bool_ok() {
        let mut args = Map::new();
        args.insert("b".into(), json!(true));
        assert!(require_bool(&args, "b").unwrap());
    }

    #[test]
    fn to_value_round_trip() {
        assert_eq!(to_value(&json!({"a": 1})).unwrap()["a"], 1);
    }

    #[test]
    fn option_helper_err_none_is_null() {
        assert_eq!(option_helper_err(None).unwrap(), Value::Null);
    }
}
