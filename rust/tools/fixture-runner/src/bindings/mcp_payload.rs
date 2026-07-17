//! Host-side MCP payload fixture adapters (Step 34).
//!
//! Deserializes fixture args and invokes `solvapay-core::mcp` builders.

use serde_json::Value;
use solvapay_core::{
    assert_response_result, make_response_result, paywall_tool_result, PaywallGate,
};

use crate::model::FixtureInput;
use crate::runner::{require_string_arg, BindingError, ErrorObservation};

/// Binding for `paywallToolResult`.
///
/// Requires `args.message` (narration) and deserializes
/// `args.structuredContent` into [`PaywallGate`].
///
/// # Errors
///
/// Returns [`BindingError::Harness`] when required args are missing or malformed.
pub(super) fn invoke_paywall_tool_result(input: &FixtureInput) -> Result<Value, BindingError> {
    let message = require_string_arg(input, "message")?;
    let gate = require_structured_content_arg(input)?;
    let result = paywall_tool_result(&message, &gate);
    serde_json::to_value(result).map_err(|e| BindingError::Harness(e.to_string()))
}

/// Binding for `makeResponseResult`.
///
/// Args: `data` (required), optional `options` object, optional `emittedBlocks` array.
///
/// # Errors
///
/// Returns [`BindingError::Harness`] when args are missing or malformed.
pub(super) fn invoke_make_response_result(input: &FixtureInput) -> Result<Value, BindingError> {
    let data = input
        .args
        .get("data")
        .cloned()
        .ok_or_else(|| BindingError::Harness("args.data is required".to_owned()))?;

    let options = match input.args.get("options") {
        None => None,
        Some(Value::Null) => {
            return Err(BindingError::Harness(
                "args.options must be an object when present".to_owned(),
            ));
        }
        Some(value) if value.is_object() => Some(value.clone()),
        Some(_) => {
            return Err(BindingError::Harness(
                "args.options must be an object when present".to_owned(),
            ));
        }
    };

    let emitted_blocks = match input.args.get("emittedBlocks") {
        None => Vec::new(),
        Some(Value::Array(items)) => items.clone(),
        Some(_) => {
            return Err(BindingError::Harness(
                "args.emittedBlocks must be an array when present".to_owned(),
            ));
        }
    };

    let envelope = make_response_result(data, options, emitted_blocks);
    serde_json::to_value(envelope).map_err(|e| BindingError::Harness(e.to_string()))
}

/// Binding for `assertResponseResult`.
///
/// Args: `value` (required). Brand failures surface as [`BindingError::Sdk`]
/// with `name: "Error"` and the frozen merchant-actionable message.
///
/// # Errors
///
/// - [`BindingError::Harness`] when `args.value` is missing
/// - [`BindingError::Sdk`] when the brand check fails
pub(super) fn invoke_assert_response_result(input: &FixtureInput) -> Result<Value, BindingError> {
    let value = input
        .args
        .get("value")
        .cloned()
        .ok_or_else(|| BindingError::Harness("args.value is required".to_owned()))?;
    match assert_response_result(&value) {
        Ok(v) => Ok(v),
        Err(message) => Err(BindingError::Sdk(ErrorObservation {
            name: Some("Error".to_owned()),
            message: message.to_owned(),
            kind: None,
            code: None,
            status: None,
        })),
    }
}

/// Deserializes required `args.structuredContent` into [`PaywallGate`].
fn require_structured_content_arg(input: &FixtureInput) -> Result<PaywallGate, BindingError> {
    let value = input
        .args
        .get("structuredContent")
        .ok_or_else(|| BindingError::Harness("args.structuredContent is required".to_owned()))?;
    serde_json::from_value(value.clone())
        .map_err(|e| BindingError::Harness(format!("invalid args.structuredContent: {e}")))
}
