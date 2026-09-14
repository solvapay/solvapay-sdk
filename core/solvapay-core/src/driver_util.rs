//! Shared JSON step-driver field readers.

use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::helper_error::HelperErrorResult;

/// Deserialize driver state from the host payload.
pub fn require_state<T: DeserializeOwned>(
    state: Option<&Value>,
    op: &str,
) -> Result<T, HelperErrorResult> {
    let value = state
        .filter(|v| !v.is_null())
        .ok_or_else(|| HelperErrorResult::transport(format!("{op} state is required")))?;
    serde_json::from_value(value.clone())
        .map_err(|err| HelperErrorResult::transport(format!("{op} invalid state: {err}")))
}

/// Read a required non-empty string field from a JSON object.
pub fn require_str(value: &Value, key: &str, op: &str) -> Result<String, HelperErrorResult> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| HelperErrorResult::transport(format!("{op} {key} is required")))
}

/// Read a required number field from a JSON object.
pub fn require_f64(value: &Value, key: &str, op: &str) -> Result<f64, HelperErrorResult> {
    value
        .get(key)
        .and_then(Value::as_f64)
        .ok_or_else(|| HelperErrorResult::transport(format!("{op} {key} must be a number")))
}

/// Fail if the driver is not waiting for the expected host step.
pub fn require_pending<T: PartialEq + std::fmt::Debug>(
    actual: &T,
    expected: &T,
    op: &str,
) -> Result<(), HelperErrorResult> {
    if actual == expected {
        Ok(())
    } else {
        Err(HelperErrorResult::transport(format!(
            "{op} expected pending {expected:?}, got {actual:?}"
        )))
    }
}
