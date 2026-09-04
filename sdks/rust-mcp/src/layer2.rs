//! Direct `solvapay-core::mcp` calls plus the `format_gate` test seam.

use rmcp::model::{CallToolResult, ContentBlock};
use serde_json::Value;
use solvapay_core::mcp::{
    assert_response_result as core_assert, build_payable_tool_result as core_build,
    make_response_result as core_make, paywall_tool_result, ResponseEnvelope,
};
use solvapay_core::PaywallGate;

use crate::register::PayableError;

#[cfg(feature = "test-seams")]
use std::sync::{OnceLock, RwLock};

/// Override used by the negative gate-copy suite.
#[cfg(feature = "test-seams")]
type FormatGateFn = fn(&str, &PaywallGate) -> CallToolResult;

/// Slot holding the optional `format_gate` override.
#[cfg(feature = "test-seams")]
fn format_gate_slot() -> &'static RwLock<Option<FormatGateFn>> {
    /// Process-wide format_gate override.
    static SLOT: OnceLock<RwLock<Option<FormatGateFn>>> = OnceLock::new();
    SLOT.get_or_init(|| RwLock::new(None))
}

/// Test-only override so the negative gate-copy suite can prove layer-2 sourcing.
#[cfg(feature = "test-seams")]
pub fn set_format_gate_override(format_gate: Option<FormatGateFn>) {
    let mut slot = match format_gate_slot().write() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    *slot = format_gate;
}

/// Whether a test-seams `format_gate` override is installed.
#[cfg(feature = "test-seams")]
pub fn format_gate_override_active() -> bool {
    let slot = match format_gate_slot().read() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    slot.is_some()
}

/// Construct a branded response envelope.
pub fn make_response_result(
    data: Value,
    options: Option<Value>,
    emitted: Vec<Value>,
) -> ResponseEnvelope {
    core_make(data, options, emitted)
}

/// Assert `value` is a branded response envelope.
///
/// # Errors
///
/// Returns [`PayableError::Handler`] with the frozen merchant message.
pub fn assert_response_result(value: &Value) -> Result<Value, PayableError> {
    core_assert(value).map_err(|msg| PayableError::Handler(msg.to_owned()))
}

/// Unwrap a branded envelope into an MCP allow-path tool result.
///
/// # Errors
///
/// Returns [`PayableError::Handler`] when a content block cannot be decoded.
pub fn build_payable_tool_result(
    envelope: &ResponseEnvelope,
) -> Result<CallToolResult, PayableError> {
    let built = core_build(envelope);
    let content = values_to_blocks(built.content)?;
    let mut result = CallToolResult::success(content);
    result.structured_content = Some(built.structured_content);
    result.is_error = built.is_error;
    Ok(result)
}

/// Format a paywall tool result from layer 2 (or the test-seams override).
///
/// # Errors
///
/// Returns [`PayableError::Handler`] when a content block cannot be decoded.
pub fn format_gate(message: &str, gate: &PaywallGate) -> Result<CallToolResult, PayableError> {
    #[cfg(feature = "test-seams")]
    {
        let over = match format_gate_slot().read() {
            Ok(guard) => *guard,
            Err(poisoned) => *poisoned.into_inner(),
        };
        if let Some(over) = over {
            return Ok(over(message, gate));
        }
    }
    let built = paywall_tool_result(message, gate);
    let content_values: Vec<Value> = built
        .content
        .into_iter()
        .map(|block| {
            serde_json::to_value(block)
                .map_err(|e| PayableError::Handler(format!("serialize paywall content block: {e}")))
        })
        .collect::<Result<_, _>>()?;
    let content = values_to_blocks(content_values)?;
    let mut result = CallToolResult::success(content);
    result.structured_content = Some(
        serde_json::to_value(&built.structured_content)
            .map_err(|e| PayableError::Handler(format!("serialize paywall gate: {e}")))?,
    );
    result.is_error = Some(false);
    Ok(result)
}

/// Decode a driver-formatted MCP tool result JSON object.
pub fn json_to_call_tool_result(value: Value) -> Result<CallToolResult, PayableError> {
    let content_values = value
        .get("content")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let content = values_to_blocks(content_values)?;
    let is_error = value.get("isError").and_then(Value::as_bool);
    let mut result = if is_error == Some(true) {
        CallToolResult::error(content)
    } else {
        CallToolResult::success(content)
    };
    if let Some(structured) = value.get("structuredContent") {
        if !structured.is_null() {
            result.structured_content = Some(structured.clone());
        }
    }
    if let Some(flag) = is_error {
        result.is_error = Some(flag);
    }
    Ok(result)
}

/// Decode JSON content-block values into rmcp `ContentBlock`s.
fn values_to_blocks(values: Vec<Value>) -> Result<Vec<ContentBlock>, PayableError> {
    values
        .into_iter()
        .map(|value| {
            serde_json::from_value(value)
                .map_err(|e| PayableError::Handler(format!("unrecognized MCP content block: {e}")))
        })
        .collect()
}
