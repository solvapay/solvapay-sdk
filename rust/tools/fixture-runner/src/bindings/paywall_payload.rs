//! Host-side client-payload fixture adapter (Step 33).
//!
//! Deserializes fixture `args.structuredContent` into [`PaywallGate`] and
//! invokes [`paywall_client_payload`], serializing the resulting payload.

use serde_json::Value;
use solvapay_core::{paywall_client_payload, PaywallGate};

use crate::model::FixtureInput;
use crate::runner::{require_string_arg, BindingError};

/// Binding for `paywallErrorToClientPayload`.
///
/// Requires `args.message` (harness guard parity) and deserializes
/// `args.structuredContent` into [`PaywallGate`]. The payload `message`
/// comes from the gate (matching TS, which reads `structuredContent.message`).
///
/// # Arguments
///
/// * `input` - Fixture input with `message` and `structuredContent` args.
///
/// # Returns
///
/// JSON value of the assembled [`solvapay_core::PaywallClientPayload`].
///
/// # Errors
///
/// Returns [`BindingError::Harness`] when required args are missing or malformed.
pub(super) fn invoke_paywall_error_to_client_payload(
    input: &FixtureInput,
) -> Result<Value, BindingError> {
    let _message = require_string_arg(input, "message")?;
    let gate = require_structured_content_arg(input)?;
    let payload = paywall_client_payload(&gate);
    serde_json::to_value(payload).map_err(|e| BindingError::Harness(e.to_string()))
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
