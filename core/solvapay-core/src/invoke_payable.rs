//! Payable MCP invocation step driver.
//!
//! Hosts resolve the customer ref, call `gate()`, invoke the merchant handler,
//! and fire usage tracks. This module sequences those steps and formats
//! paywall / allow MCP tool results so every language ships the same envelope.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::helper_error::HelperErrorResult;
use crate::mcp::{
    assert_response_result, build_payable_tool_result, paywall_tool_result, ResponseEnvelope,
};
use crate::paywall_gate::PaywallGate;
use crate::serde_util::serialize_whole_f64;

/// Driver state between payable steps.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvokePayableState {
    /// Product the tool is protected against.
    pub product: String,
    /// Meter / usage type.
    pub usage_type: String,
    /// Customer ref after host resolution.
    pub customer_ref: String,
    /// Host clock at start (ms).
    pub started_ms: i64,
}

/// Next host action or a formatted tool result.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[allow(clippy::large_enum_variant)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum InvokePayableAction {
    /// Host must call `gate(customerRef, product, usageType)`.
    #[serde(rename_all = "camelCase")]
    RunGate {
        /// Resolved customer ref.
        customer_ref: String,
        /// Product reference.
        product: String,
        /// Meter name.
        usage_type: String,
    },
    /// Host must invoke the merchant handler with this customer/limits snapshot.
    #[serde(rename_all = "camelCase")]
    InvokeHandler {
        /// Backend customer ref.
        customer_ref: String,
        /// Limits snapshot from the allow arm.
        limits: Value,
    },
    /// Terminal MCP tool result. Host applies `track` then returns `result`.
    #[serde(rename_all = "camelCase")]
    Done {
        /// Formatted MCP tool result.
        result: Value,
        /// Optional usage track (`success` / `fail` / omitted for paywall —
        /// paywall tracking is owned by the gate driver).
        #[serde(skip_serializing_if = "Option::is_none")]
        track: Option<InvokePayableTrack>,
    },
}

/// Post-handler usage track.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvokePayableTrack {
    /// `"success"` or `"fail"`.
    pub outcome: String,
    /// Elapsed ms from start.
    #[serde(serialize_with = "serialize_whole_f64")]
    pub duration_ms: f64,
}

/// Driver output.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvokePayableNextOutput {
    /// State to pass into the next call.
    pub state: InvokePayableState,
    /// Host action or terminal result.
    pub action: InvokePayableAction,
}

/// Advance payable invocation by one step.
///
/// # Arguments
///
/// * `state` - Previous state, or `None` on `start`.
/// * `event` - Host event tagged with `kind`.
///
/// # Errors
///
/// [`HelperErrorResult`] on malformed events, missing gate payloads, or
/// envelopes that fail [`assert_response_result`].
#[crate::solvapay_export(
    artifact = "payloadBuilders",
    catalog = "none",
    section = "MCP payload / descriptors",
    emit_order = 42
)]
pub fn invoke_payable_next(
    state: Option<&Value>,
    event: Option<&Value>,
) -> Result<InvokePayableNextOutput, HelperErrorResult> {
    let event = event
        .ok_or_else(|| HelperErrorResult::transport("invoke_payable_next event is required"))?;
    let kind = event.get("kind").and_then(Value::as_str).ok_or_else(|| {
        HelperErrorResult::transport("invoke_payable_next event.kind is required")
    })?;
    match kind {
        "start" => start(event),
        "gatePaywall" => on_gate_paywall(require_state(state)?, event),
        "gateAllow" => on_gate_allow(require_state(state)?, event),
        "handlerPaywall" => on_handler_paywall(require_state(state)?, event),
        "handlerOk" => on_handler_ok(require_state(state)?, event),
        "handlerErr" => on_handler_err(require_state(state)?, event),
        other => Err(HelperErrorResult::transport(format!(
            "invoke_payable_next unknown event kind: {other}"
        ))),
    }
}

/// Handle a `start` event by asking the host to run the paywall gate.
fn start(event: &Value) -> Result<InvokePayableNextOutput, HelperErrorResult> {
    let customer_ref = require_str(event, "customerRef")?;
    let product = require_str(event, "product")?;
    let usage_type = event
        .get("usageType")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .unwrap_or("requests")
        .to_owned();
    let started_ms = event.get("startedMs").and_then(Value::as_i64).unwrap_or(0);
    let state = InvokePayableState {
        product: product.clone(),
        usage_type: usage_type.clone(),
        customer_ref: customer_ref.clone(),
        started_ms,
    };
    Ok(InvokePayableNextOutput {
        state,
        action: InvokePayableAction::RunGate {
            customer_ref,
            product,
            usage_type,
        },
    })
}

/// Handle a gated `gatePaywall` event: format the paywall tool result and stop.
fn on_gate_paywall(
    state: InvokePayableState,
    event: &Value,
) -> Result<InvokePayableNextOutput, HelperErrorResult> {
    let result = format_paywall(event)?;
    Ok(done(state, result, None))
}

/// Handle a `gateAllow` event by asking the host to invoke the merchant handler.
fn on_gate_allow(
    mut state: InvokePayableState,
    event: &Value,
) -> Result<InvokePayableNextOutput, HelperErrorResult> {
    if let Some(customer_ref) = event.get("customerRef").and_then(Value::as_str) {
        state.customer_ref = customer_ref.to_owned();
    }
    let limits = event.get("limits").cloned().unwrap_or(json!({}));
    let customer_ref = state.customer_ref.clone();
    Ok(InvokePayableNextOutput {
        state,
        action: InvokePayableAction::InvokeHandler {
            customer_ref,
            limits,
        },
    })
}

/// Handle a `handlerPaywall` event: format the paywall tool result and stop.
fn on_handler_paywall(
    state: InvokePayableState,
    event: &Value,
) -> Result<InvokePayableNextOutput, HelperErrorResult> {
    let result = format_paywall(event)?;
    Ok(done(state, result, None))
}

/// Handle a `handlerOk` event: brand the envelope and emit a success track.
fn on_handler_ok(
    state: InvokePayableState,
    event: &Value,
) -> Result<InvokePayableNextOutput, HelperErrorResult> {
    let envelope_value = event
        .get("envelope")
        .cloned()
        .ok_or_else(|| HelperErrorResult::transport("invoke_payable_next envelope is required"))?;
    let branded = assert_response_result(&envelope_value)
        .map_err(|err| HelperErrorResult::transport(err.to_owned()))?;
    let envelope: ResponseEnvelope = serde_json::from_value(branded).map_err(|err| {
        HelperErrorResult::transport(format!("invoke_payable_next envelope: {err}"))
    })?;
    let result = serde_json::to_value(build_payable_tool_result(&envelope))
        .map_err(|err| HelperErrorResult::transport(format!("serialize payable result: {err}")))?;
    let now_ms = event
        .get("nowMs")
        .and_then(Value::as_i64)
        .unwrap_or(state.started_ms);
    let duration_ms = (now_ms - state.started_ms).max(0) as f64;
    Ok(done(
        state,
        result,
        Some(InvokePayableTrack {
            outcome: "success".to_owned(),
            duration_ms,
        }),
    ))
}

/// Handle a `handlerErr` event: emit an error tool result and a fail track.
fn on_handler_err(
    state: InvokePayableState,
    event: &Value,
) -> Result<InvokePayableNextOutput, HelperErrorResult> {
    let message = event
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("handler failed");
    let result = json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string_pretty(&json!({ "success": false, "error": message }))
                .unwrap_or_else(|_| message.to_owned()),
        }],
        "isError": true,
    });
    let now_ms = event
        .get("nowMs")
        .and_then(Value::as_i64)
        .unwrap_or(state.started_ms);
    let duration_ms = (now_ms - state.started_ms).max(0) as f64;
    Ok(done(
        state,
        result,
        Some(InvokePayableTrack {
            outcome: "fail".to_owned(),
            duration_ms,
        }),
    ))
}

/// Build a paywall MCP tool result from the host-supplied gate payload.
fn format_paywall(event: &Value) -> Result<Value, HelperErrorResult> {
    let gate_value = event
        .get("gate")
        .cloned()
        .ok_or_else(|| HelperErrorResult::transport("invoke_payable_next gate is required"))?;
    let gate: PaywallGate = serde_json::from_value(gate_value)
        .map_err(|err| HelperErrorResult::transport(format!("invoke_payable_next gate: {err}")))?;
    let message = event
        .get("message")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| {
            if gate.message.is_empty() {
                "Payment required".to_owned()
            } else {
                gate.message.clone()
            }
        });
    serde_json::to_value(paywall_tool_result(&message, &gate))
        .map_err(|err| HelperErrorResult::transport(format!("serialize paywall result: {err}")))
}

/// Terminal output: keep state, return the tool result, optional usage track.
fn done(
    state: InvokePayableState,
    result: Value,
    track: Option<InvokePayableTrack>,
) -> InvokePayableNextOutput {
    InvokePayableNextOutput {
        state,
        action: InvokePayableAction::Done { result, track },
    }
}

/// Deserialize driver state from the host payload.
fn require_state(state: Option<&Value>) -> Result<InvokePayableState, HelperErrorResult> {
    let value = state
        .ok_or_else(|| HelperErrorResult::transport("invoke_payable_next state is required"))?;
    serde_json::from_value(value.clone()).map_err(|err| {
        HelperErrorResult::transport(format!("invoke_payable_next invalid state: {err}"))
    })
}

/// Read a required string field from a JSON object.
fn require_str(value: &Value, key: &str) -> Result<String, HelperErrorResult> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| {
            HelperErrorResult::transport(format!("invoke_payable_next {key} is required"))
        })
}

#[cfg(test)]
mod tests {
    #![allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::missing_docs_in_private_items,
        clippy::cast_precision_loss
    )]

    use super::*;
    use crate::paywall_gate::{build_paywall_gate, PaywallGateLimits};
    use serde_json::json;

    fn start_out() -> InvokePayableNextOutput {
        invoke_payable_next(
            None,
            Some(&json!({
                "kind": "start",
                "customerRef": "cus_1",
                "product": "prd_1",
                "usageType": "requests",
                "startedMs": 10,
            })),
        )
        .unwrap()
    }

    #[test]
    fn start_requests_gate() {
        match &start_out().action {
            InvokePayableAction::RunGate {
                customer_ref,
                product,
                ..
            } => {
                assert_eq!(customer_ref, "cus_1");
                assert_eq!(product, "prd_1");
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn gate_allow_requests_handler() {
        let started = start_out();
        let out = invoke_payable_next(
            Some(&serde_json::to_value(&started.state).unwrap()),
            Some(&json!({
                "kind": "gateAllow",
                "customerRef": "cus_1",
                "limits": { "remaining": 4, "withinLimits": true },
            })),
        )
        .unwrap();
        match &out.action {
            InvokePayableAction::InvokeHandler { limits, .. } => {
                assert_eq!(limits["remaining"], 4);
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn handler_ok_builds_tool_result_and_tracks_success() {
        let started = start_out();
        let allow = invoke_payable_next(
            Some(&serde_json::to_value(&started.state).unwrap()),
            Some(&json!({ "kind": "gateAllow", "limits": {} })),
        )
        .unwrap();
        let envelope = json!({
            "__solvapayResponse": true,
            "data": { "ok": true },
        });
        let out = invoke_payable_next(
            Some(&serde_json::to_value(&allow.state).unwrap()),
            Some(&json!({
                "kind": "handlerOk",
                "envelope": envelope,
                "nowMs": 40,
            })),
        )
        .unwrap();
        match &out.action {
            InvokePayableAction::Done { result, track } => {
                assert_eq!(result["structuredContent"]["ok"], true);
                let track = track.as_ref().expect("track");
                assert_eq!(track.outcome, "success");
                assert_eq!(track.duration_ms, 30.0);
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn gate_paywall_formats_tool_result() {
        let started = start_out();
        let gate = build_paywall_gate(
            "prd_1",
            &PaywallGateLimits {
                remaining: Some(0.0),
                ..PaywallGateLimits::default()
            },
        );
        let out = invoke_payable_next(
            Some(&serde_json::to_value(&started.state).unwrap()),
            Some(&json!({
                "kind": "gatePaywall",
                "gate": gate,
            })),
        )
        .unwrap();
        match &out.action {
            InvokePayableAction::Done { result, track } => {
                assert_eq!(result["isError"], false);
                assert!(track.is_none());
            }
            other => panic!("unexpected {other:?}"),
        }
    }
}
