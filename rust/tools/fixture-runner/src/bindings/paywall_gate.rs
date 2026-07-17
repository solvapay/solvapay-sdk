//! Host-side paywall gate fixture adapter (Step 14).
//!
//! Deserializes fixture args into [`PaywallGateLimits`] and invokes
//! [`build_paywall_gate`], serializing the resulting gate to JSON.

use serde_json::Value;
use solvapay_core::{build_paywall_gate, PaywallGateLimits};

use crate::model::FixtureInput;
use crate::runner::{require_string_arg, BindingError};

/// Binding for `buildPaywallGate`.
///
/// Reads required `args.productRef` and `args.limits`, invokes
/// [`build_paywall_gate`], and returns the serialized gate object.
///
/// # Arguments
///
/// * `input` - Fixture input with `productRef` and `limits` args.
///
/// # Returns
///
/// JSON value of the assembled [`solvapay_core::PaywallGate`].
///
/// # Errors
///
/// Returns [`BindingError::Harness`] when required args are missing or malformed.
pub(super) fn invoke_build_paywall_gate(input: &FixtureInput) -> Result<Value, BindingError> {
    let product_ref = require_string_arg(input, "productRef")?;
    let limits = require_limits_arg(input)?;
    let gate = build_paywall_gate(&product_ref, &limits);
    serde_json::to_value(gate).map_err(|e| BindingError::Harness(e.to_string()))
}

/// Deserializes required `args.limits` into [`PaywallGateLimits`].
///
/// Extra keys on nested pass-through blocks are preserved (raw `Value`).
fn require_limits_arg(input: &FixtureInput) -> Result<PaywallGateLimits, BindingError> {
    let value = input
        .args
        .get("limits")
        .ok_or_else(|| BindingError::Harness("args.limits is required".to_owned()))?;
    serde_json::from_value(value.clone())
        .map_err(|e| BindingError::Harness(format!("invalid args.limits: {e}")))
}
