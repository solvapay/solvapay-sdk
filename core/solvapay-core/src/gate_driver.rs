//! Paywall gate step driver (cross-language sequencing).
//!
//! Decision math stays in [`crate::paywall_decision`]. This module owns only
//! the ten-step order and emits host I/O / cache actions. Hosts supply cache
//! maps, HTTP, and clocks; they must not re-express cached/fresh evaluation
//! or `decide_paywall_outcome`.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::customer_sync::{classify_customer_ref, CustomerRefKind};
use crate::helper_error::HelperErrorResult;
use crate::limits::resolve_check_limits_params;
use crate::paywall_decision::{
    decide_paywall_outcome, evaluate_cached_limits, evaluate_fresh_limits,
};
use crate::paywall_gate::PaywallGate;
use crate::serde_util::serialize_whole_f64;

/// Opaque-enough driver state passed back on every step.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GateDriverState {
    /// Product reference used for limits and the assembled gate.
    pub product: String,
    /// Resolved meter name (`usageType` with the `requests` default).
    pub meter_name: String,
    /// Customer ref supplied on `start`.
    pub original_customer_ref: String,
    /// Backend customer ref after classify / ensure.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backend_ref: Option<String>,
    /// Host clock at `start` (ms). Used for paywall `track` duration.
    pub started_ms: i64,
    /// `backendRef:product:meterName` once the backend ref is known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limits_key: Option<String>,
}

/// Cache mutation the host must apply before continuing / returning.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum GateCacheOp {
    /// Write a fresh cache-miss evaluation.
    Set {
        /// Limits cache key.
        key: String,
        /// Remaining after optimistic consume.
        #[serde(serialize_with = "serialize_whole_f64")]
        remaining: f64,
        /// Raw `checkLimits` body.
        limits: Value,
        /// Host `nowMs` at the miss.
        timestamp: i64,
    },
    /// Optimistic decrement on a cache hit that stays within limits.
    UpdateRemaining {
        /// Limits cache key.
        key: String,
        /// Remaining after decrement.
        #[serde(serialize_with = "serialize_whole_f64")]
        remaining: f64,
    },
    /// Evict a spent or stale entry.
    Delete {
        /// Limits cache key.
        key: String,
    },
}

/// Paywall usage track the host must fire on a gate outcome.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GateTrackOp {
    /// Backend customer ref.
    pub customer_ref: String,
    /// Product reference.
    pub product_ref: String,
    /// Meter / action name.
    pub action: String,
    /// Always `"paywall"` for this driver.
    pub outcome: String,
    /// Elapsed ms from `start` (`max(0, nowMs - startedMs)`).
    #[serde(serialize_with = "serialize_whole_f64")]
    pub duration_ms: f64,
}

/// Next host action, or a terminal allow/gate.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[allow(clippy::large_enum_variant)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum GateAction {
    /// Host must resolve/create the customer, then send `customerResolved`.
    #[serde(rename_all = "camelCase")]
    EnsureCustomer {
        /// Original customer ref.
        customer_ref: String,
    },
    /// Host looks up the limits cache (applying TTL itself) and sends
    /// `cacheHit` or `cacheMiss`.
    #[serde(rename_all = "camelCase")]
    LookupCache {
        /// Limits cache key.
        key: String,
    },
    /// Host calls `checkLimits` (must pass `includeCheckoutSession`).
    #[serde(rename_all = "camelCase")]
    CheckLimits {
        /// Backend customer ref.
        customer_ref: String,
        /// Product reference.
        product_ref: String,
        /// Meter name.
        meter_name: String,
        /// Always `true` — gate assembly needs `checkoutUrl`.
        include_checkout_session: bool,
        /// Optional key to delete before the HTTP call (stale entry).
        #[serde(skip_serializing_if = "Option::is_none")]
        cache_delete_key: Option<String>,
    },
    /// Terminal allow or gate. Host applies `cache` / `track` then returns.
    #[serde(rename_all = "camelCase")]
    Done {
        /// `"allow"` or `"gate"`.
        outcome: String,
        /// Backend customer ref.
        customer_ref: String,
        /// Product reference.
        product: String,
        /// Meter name.
        meter_name: String,
        /// Last `checkLimits` body (or cached copy). Empty object when absent.
        limits: Value,
        /// Assembled gate when `outcome` is `"gate"`.
        #[serde(skip_serializing_if = "Option::is_none")]
        gate: Option<PaywallGate>,
        /// Optional cache mutation.
        #[serde(skip_serializing_if = "Option::is_none")]
        cache: Option<GateCacheOp>,
        /// Optional paywall usage track.
        #[serde(skip_serializing_if = "Option::is_none")]
        track: Option<GateTrackOp>,
    },
}

/// Driver output: updated state plus the next action.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GateNextOutput {
    /// State to pass into the next `gate_next` call.
    pub state: GateDriverState,
    /// Host action or terminal result.
    pub action: GateAction,
}

/// Advance the gate sequence by one step.
///
/// # Arguments
///
/// * `state` - Previous [`GateNextOutput::state`], or `None` on `start`.
/// * `event` - Host event tagged with `kind`.
///
/// # Errors
///
/// [`HelperErrorResult`] transport when `event` is missing `kind` or a required field.
/// Product-ref failures reuse the limits helper 400 payload.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "none",
    section = "paywall-decision",
    emit_order = 41
)]
pub fn gate_next(
    state: Option<&Value>,
    event: Option<&Value>,
) -> Result<GateNextOutput, HelperErrorResult> {
    let event = event.ok_or_else(|| HelperErrorResult::transport("gate_next event is required"))?;
    let kind = event
        .get("kind")
        .and_then(Value::as_str)
        .ok_or_else(|| HelperErrorResult::transport("gate_next event.kind is required"))?;
    match kind {
        "start" => start(event),
        "customerResolved" => {
            let mut st = require_state(state)?;
            let backend = require_str(event, "backendRef")?;
            st.backend_ref = Some(backend.clone());
            st.limits_key = Some(limits_key(&backend, &st.product, &st.meter_name));
            let key = st.limits_key.clone().unwrap_or_default();
            Ok(GateNextOutput {
                state: st,
                action: GateAction::LookupCache { key },
            })
        }
        "cacheHit" => on_cache_hit(require_state(state)?, event),
        "cacheMiss" => on_cache_miss(require_state(state)?, event),
        "limitsResult" => on_limits_result(require_state(state)?, event),
        other => Err(HelperErrorResult::transport(format!(
            "gate_next unknown event kind: {other}"
        ))),
    }
}

/// Handle a `start` event: ensure the customer or look up the limits cache.
fn start(event: &Value) -> Result<GateNextOutput, HelperErrorResult> {
    let customer_ref = require_str(event, "customerRef")?;
    let product = require_str(event, "product")?;
    let usage_type = event.get("usageType").and_then(Value::as_str);
    let started_ms = event.get("startedMs").and_then(Value::as_i64).unwrap_or(0);
    let resolved = resolve_check_limits_params(Some(&product), None, usage_type)?;
    let mut state = GateDriverState {
        product: resolved.product_ref,
        meter_name: resolved.meter_name,
        original_customer_ref: customer_ref.clone(),
        backend_ref: None,
        started_ms,
        limits_key: None,
    };
    match classify_customer_ref(&customer_ref) {
        CustomerRefKind::NeedsEnsure => Ok(GateNextOutput {
            state,
            action: GateAction::EnsureCustomer { customer_ref },
        }),
        CustomerRefKind::Anonymous | CustomerRefKind::Backend => {
            state.backend_ref = Some(customer_ref.clone());
            let key = limits_key(&customer_ref, &state.product, &state.meter_name);
            state.limits_key = Some(key.clone());
            Ok(GateNextOutput {
                state,
                action: GateAction::LookupCache { key },
            })
        }
    }
}

/// Handle a `cacheHit` event and decide allow vs check-limits.
fn on_cache_hit(
    state: GateDriverState,
    event: &Value,
) -> Result<GateNextOutput, HelperErrorResult> {
    let remaining = require_f64(event, "remaining")?;
    let limits = event.get("limits").cloned().unwrap_or(json!({}));
    let now_ms = event.get("nowMs").and_then(Value::as_i64).unwrap_or(0);
    let eval = evaluate_cached_limits(remaining);
    let key = state.limits_key.clone().unwrap_or_default();
    let cache = if eval.evict {
        Some(GateCacheOp::Delete { key })
    } else if eval.within_limits {
        Some(GateCacheOp::UpdateRemaining {
            key,
            remaining: eval.remaining,
        })
    } else {
        None
    };
    Ok(finish(state, eval.within_limits, limits, cache, now_ms))
}

/// Handle a `cacheMiss` event by requesting a fresh `checkLimits` call.
fn on_cache_miss(
    state: GateDriverState,
    _event: &Value,
) -> Result<GateNextOutput, HelperErrorResult> {
    let customer_ref = state
        .backend_ref
        .clone()
        .ok_or_else(|| HelperErrorResult::transport("gate_next cacheMiss without backendRef"))?;
    Ok(GateNextOutput {
        action: GateAction::CheckLimits {
            customer_ref,
            product_ref: state.product.clone(),
            meter_name: state.meter_name.clone(),
            include_checkout_session: true,
            cache_delete_key: state.limits_key.clone(),
        },
        state,
    })
}

/// Handle a `limitsResult` event and produce the terminal gate outcome.
fn on_limits_result(
    state: GateDriverState,
    event: &Value,
) -> Result<GateNextOutput, HelperErrorResult> {
    let limits = event.get("limits").cloned().unwrap_or(json!({}));
    let now_ms = event.get("nowMs").and_then(Value::as_i64).unwrap_or(0);
    let within = limits
        .get("withinLimits")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let remaining = limits
        .get("remaining")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let eval = evaluate_fresh_limits(within, remaining);
    let key = state.limits_key.clone().unwrap_or_default();
    let cache = if eval.should_cache {
        Some(GateCacheOp::Set {
            key,
            remaining: eval.remaining,
            limits: limits.clone(),
            timestamp: now_ms,
        })
    } else {
        None
    };
    Ok(finish(state, eval.within_limits, limits, cache, now_ms))
}

/// Build the terminal allow/gate action, optional cache write, and usage track.
fn finish(
    state: GateDriverState,
    within_limits: bool,
    limits: Value,
    cache: Option<GateCacheOp>,
    now_ms: i64,
) -> GateNextOutput {
    let checkout_url = limits.get("checkoutUrl").and_then(Value::as_str);
    let decision = decide_paywall_outcome(
        within_limits,
        &state.product,
        if limits.is_null() {
            None
        } else {
            Some(&limits)
        },
        checkout_url,
    );
    let customer_ref = state
        .backend_ref
        .clone()
        .unwrap_or_else(|| state.original_customer_ref.clone());
    let duration_ms = (now_ms - state.started_ms).max(0) as f64;
    match decision {
        crate::paywall_decision::PaywallOutcome::Allow => GateNextOutput {
            action: GateAction::Done {
                outcome: "allow".to_owned(),
                customer_ref,
                product: state.product.clone(),
                meter_name: state.meter_name.clone(),
                limits,
                gate: None,
                cache,
                track: None,
            },
            state,
        },
        crate::paywall_decision::PaywallOutcome::Gate { gate } => GateNextOutput {
            action: GateAction::Done {
                outcome: "gate".to_owned(),
                customer_ref: customer_ref.clone(),
                product: state.product.clone(),
                meter_name: state.meter_name.clone(),
                limits,
                gate: Some(gate),
                cache,
                track: Some(GateTrackOp {
                    customer_ref,
                    product_ref: state.product.clone(),
                    action: state.meter_name.clone(),
                    outcome: "paywall".to_owned(),
                    duration_ms,
                }),
            },
            state,
        },
    }
}

/// Cache key `{backend}:{product}:{meter}` used by the host lookup.
fn limits_key(backend: &str, product: &str, meter: &str) -> String {
    format!("{backend}:{product}:{meter}")
}

/// Deserialize driver state from the host payload.
fn require_state(state: Option<&Value>) -> Result<GateDriverState, HelperErrorResult> {
    let value = state.ok_or_else(|| HelperErrorResult::transport("gate_next state is required"))?;
    serde_json::from_value(value.clone())
        .map_err(|err| HelperErrorResult::transport(format!("gate_next invalid state: {err}")))
}

/// Read a required string field from a JSON object.
fn require_str(value: &Value, key: &str) -> Result<String, HelperErrorResult> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| HelperErrorResult::transport(format!("gate_next {key} is required")))
}

/// Read a required number field from a JSON object.
fn require_f64(value: &Value, key: &str) -> Result<f64, HelperErrorResult> {
    value
        .get(key)
        .and_then(Value::as_f64)
        .ok_or_else(|| HelperErrorResult::transport(format!("gate_next {key} must be a number")))
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
    use serde_json::json;

    fn start_event(customer: &str) -> Value {
        json!({
            "kind": "start",
            "customerRef": customer,
            "product": "prd_1",
            "usageType": "requests",
            "startedMs": 1_000,
        })
    }

    fn action_kind(out: &GateNextOutput) -> &str {
        match &out.action {
            GateAction::EnsureCustomer { .. } => "ensureCustomer",
            GateAction::LookupCache { .. } => "lookupCache",
            GateAction::CheckLimits { .. } => "checkLimits",
            GateAction::Done { outcome, .. } => outcome,
        }
    }

    #[test]
    fn start_anonymous_skips_ensure() {
        let out = gate_next(None, Some(&start_event("anonymous"))).unwrap();
        assert_eq!(action_kind(&out), "lookupCache");
        match &out.action {
            GateAction::LookupCache { key } => {
                assert_eq!(key, "anonymous:prd_1:requests");
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn start_cus_skips_ensure() {
        let out = gate_next(None, Some(&start_event("cus_abc"))).unwrap();
        assert_eq!(action_kind(&out), "lookupCache");
    }

    #[test]
    fn start_app_ref_requests_ensure() {
        let out = gate_next(None, Some(&start_event("user-1"))).unwrap();
        assert_eq!(action_kind(&out), "ensureCustomer");
        match &out.action {
            GateAction::EnsureCustomer { customer_ref } => {
                assert_eq!(customer_ref, "user-1");
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn cache_hit_remaining_5_allows_and_decrements() {
        let started = gate_next(None, Some(&start_event("cus_abc"))).unwrap();
        let state = serde_json::to_value(&started.state).unwrap();
        let out = gate_next(
            Some(&state),
            Some(&json!({
                "kind": "cacheHit",
                "remaining": 5,
                "limits": { "withinLimits": true, "remaining": 5, "checkoutUrl": "https://pay" },
                "nowMs": 1_010,
            })),
        )
        .unwrap();
        match &out.action {
            GateAction::Done {
                outcome,
                cache,
                track,
                ..
            } => {
                assert_eq!(outcome, "allow");
                assert!(track.is_none());
                match cache {
                    Some(GateCacheOp::UpdateRemaining { remaining, .. }) => {
                        assert_eq!(*remaining, 4.0);
                    }
                    other => panic!("unexpected cache {other:?}"),
                }
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn cache_hit_remaining_0_gates_and_evicts() {
        let started = gate_next(None, Some(&start_event("cus_abc"))).unwrap();
        let state = serde_json::to_value(&started.state).unwrap();
        let out = gate_next(
            Some(&state),
            Some(&json!({
                "kind": "cacheHit",
                "remaining": 0,
                "limits": { "withinLimits": false, "remaining": 0 },
                "nowMs": 1_250,
            })),
        )
        .unwrap();
        match &out.action {
            GateAction::Done {
                outcome,
                cache,
                track,
                gate,
                ..
            } => {
                assert_eq!(outcome, "gate");
                assert!(gate.is_some());
                assert!(matches!(cache, Some(GateCacheOp::Delete { .. })));
                let track = track.as_ref().expect("track");
                assert_eq!(track.outcome, "paywall");
                assert_eq!(track.duration_ms, 250.0);
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn cache_miss_requests_check_limits_with_checkout_session() {
        let started = gate_next(None, Some(&start_event("cus_abc"))).unwrap();
        let state = serde_json::to_value(&started.state).unwrap();
        let out = gate_next(
            Some(&state),
            Some(&json!({ "kind": "cacheMiss", "nowMs": 1_000 })),
        )
        .unwrap();
        match &out.action {
            GateAction::CheckLimits {
                include_checkout_session,
                meter_name,
                cache_delete_key,
                ..
            } => {
                assert!(*include_checkout_session);
                assert_eq!(meter_name, "requests");
                assert_eq!(cache_delete_key.as_deref(), Some("cus_abc:prd_1:requests"));
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn fresh_within_limits_allows_and_caches() {
        let started = gate_next(None, Some(&start_event("cus_abc"))).unwrap();
        let miss = gate_next(
            Some(&serde_json::to_value(&started.state).unwrap()),
            Some(&json!({ "kind": "cacheMiss" })),
        )
        .unwrap();
        let out = gate_next(
            Some(&serde_json::to_value(&miss.state).unwrap()),
            Some(&json!({
                "kind": "limitsResult",
                "limits": { "withinLimits": true, "remaining": 3, "checkoutUrl": "https://pay" },
                "nowMs": 1_100,
            })),
        )
        .unwrap();
        match &out.action {
            GateAction::Done {
                outcome,
                cache,
                track,
                ..
            } => {
                assert_eq!(outcome, "allow");
                assert!(track.is_none());
                match cache {
                    Some(GateCacheOp::Set {
                        remaining,
                        timestamp,
                        ..
                    }) => {
                        assert_eq!(*remaining, 2.0);
                        assert_eq!(*timestamp, 1_100);
                    }
                    other => panic!("unexpected cache {other:?}"),
                }
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn fresh_blocked_gates_without_cache() {
        let started = gate_next(None, Some(&start_event("cus_abc"))).unwrap();
        let miss = gate_next(
            Some(&serde_json::to_value(&started.state).unwrap()),
            Some(&json!({ "kind": "cacheMiss" })),
        )
        .unwrap();
        let out = gate_next(
            Some(&serde_json::to_value(&miss.state).unwrap()),
            Some(&json!({
                "kind": "limitsResult",
                "limits": { "withinLimits": false, "remaining": 0 },
                "nowMs": 1_000,
            })),
        )
        .unwrap();
        match &out.action {
            GateAction::Done {
                outcome,
                cache,
                track,
                ..
            } => {
                assert_eq!(outcome, "gate");
                assert!(cache.is_none());
                assert!(track.is_some());
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn customer_resolved_looks_up_cache() {
        let started = gate_next(None, Some(&start_event("user-1"))).unwrap();
        let out = gate_next(
            Some(&serde_json::to_value(&started.state).unwrap()),
            Some(&json!({ "kind": "customerResolved", "backendRef": "cus_new" })),
        )
        .unwrap();
        match &out.action {
            GateAction::LookupCache { key } => {
                assert_eq!(key, "cus_new:prd_1:requests");
            }
            other => panic!("unexpected {other:?}"),
        }
    }
}
