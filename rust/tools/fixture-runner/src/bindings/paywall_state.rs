//! Host-side paywall state fixture adapters (Step 13).
//!
//! Deserializes fixture args into core DTOs and invokes
//! [`classify_paywall_state`] / [`build_gate_message`] / [`build_nudge_message`].

use serde_json::Value;
use solvapay_core::{
    build_gate_message, build_nudge_message, classify_paywall_state, GateContent, PaywallLimits,
    PaywallState,
};

use crate::model::FixtureInput;
use crate::runner::{args_object, BindingError};

/// Binding for `classifyPaywallState`.
///
/// Reads optional `args.limits` (`null` / absent → `None`), invokes
/// [`classify_paywall_state`], and returns the tagged `{ kind }` JSON object.
///
/// # Arguments
///
/// * `input` - Fixture input with optional `limits` arg.
///
/// # Returns
///
/// JSON value of the classified [`PaywallState`].
///
/// # Errors
///
/// Returns [`BindingError::Harness`] when `limits` cannot be deserialized.
pub(super) fn invoke_classify_paywall_state(input: &FixtureInput) -> Result<Value, BindingError> {
    let limits = optional_limits_arg(input)?;
    let state = classify_paywall_state(limits.as_ref());
    serde_json::to_value(state).map_err(|e| BindingError::Harness(e.to_string()))
}

/// Binding for `buildGateMessage`.
///
/// Reads required `args.state` and `args.gate`, invokes [`build_gate_message`].
///
/// # Arguments
///
/// * `input` - Fixture input with `state` and `gate` args.
///
/// # Returns
///
/// JSON string of the frozen gate copy.
///
/// # Errors
///
/// Returns [`BindingError::Harness`] when required args are missing or malformed.
pub(super) fn invoke_build_gate_message(input: &FixtureInput) -> Result<Value, BindingError> {
    let state = require_state_arg(input)?;
    let gate = require_gate_arg(input)?;
    Ok(Value::String(build_gate_message(&state, &gate)))
}

/// Binding for `buildNudgeMessage`.
///
/// Reads required `args.state` and optional `args.limits`, invokes
/// [`build_nudge_message`].
///
/// # Arguments
///
/// * `input` - Fixture input with `state` and optional `limits` args.
///
/// # Returns
///
/// JSON string of the frozen nudge copy.
///
/// # Errors
///
/// Returns [`BindingError::Harness`] when args are missing or malformed.
pub(super) fn invoke_build_nudge_message(input: &FixtureInput) -> Result<Value, BindingError> {
    let state = require_state_arg(input)?;
    let limits = optional_limits_arg(input)?;
    Ok(Value::String(build_nudge_message(&state, limits.as_ref())))
}

/// Deserializes optional `args.limits` (`null` / absent → `None`).
fn optional_limits_arg(input: &FixtureInput) -> Result<Option<PaywallLimits>, BindingError> {
    match args_object(input).get("limits") {
        None | Some(Value::Null) => Ok(None),
        Some(value) => serde_json::from_value(value.clone())
            .map(Some)
            .map_err(|e| BindingError::Harness(format!("invalid args.limits: {e}"))),
    }
}

/// Deserializes required `args.state`.
fn require_state_arg(input: &FixtureInput) -> Result<PaywallState, BindingError> {
    let value = input
        .args
        .get("state")
        .ok_or_else(|| BindingError::Harness("args.state is required".to_owned()))?;
    serde_json::from_value(value.clone())
        .map_err(|e| BindingError::Harness(format!("invalid args.state: {e}")))
}

/// Deserializes required `args.gate` into [`GateContent`].
///
/// Extra fields on the fixture gate object are ignored (only `checkoutUrl` is read).
fn require_gate_arg(input: &FixtureInput) -> Result<GateContent, BindingError> {
    let value = input
        .args
        .get("gate")
        .ok_or_else(|| BindingError::Harness("args.gate is required".to_owned()))?;
    serde_json::from_value(value.clone())
        .map_err(|e| BindingError::Harness(format!("invalid args.gate: {e}")))
}
