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
use crate::random::{iso8601_millis, random9_from_f64};
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
    /// Limits-cache TTL in ms (`limitsCacheTTLMs`, default 10000).
    #[serde(rename = "limitsCacheTTLMs")]
    pub limits_cache_ttl_ms: i64,
}

/// Merchant-facing customer projection from the last limits check.
///
/// Rust applies `creditBalance ?? 0` and `withinLimits ?? true` so hosts do not
/// re-derive those defaults.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomerSnapshot {
    /// Backend customer ref.
    #[serde(rename = "ref")]
    pub customer_ref: String,
    /// `creditBalance` from limits, or `0` when absent.
    #[serde(serialize_with = "serialize_whole_f64")]
    pub balance: f64,
    /// Remaining allowance from limits (JSON `null` when absent).
    pub remaining: Value,
    /// `withinLimits` from limits, or `true` when absent.
    pub within_limits: bool,
    /// Plan field from limits; omitted when absent / JSON `null`.
    #[serde(default, skip_serializing_if = "Value::is_null")]
    pub plan: Value,
}

/// Cache mutation the host must apply before continuing / returning.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum GateCacheOp {
    /// Write a fresh cache-miss evaluation.
    #[serde(rename_all = "camelCase")]
    Set {
        /// Limits cache key.
        key: String,
        /// Remaining after optimistic consume.
        #[serde(serialize_with = "serialize_whole_f64")]
        remaining: f64,
        /// Raw `checkLimits` body.
        limits: Value,
        /// Host `nowMs` at the miss — authoritative; hosts must not restamp.
        timestamp: i64,
        /// Projected from `limits.checkoutUrl` so hosts do not re-read it.
        #[serde(skip_serializing_if = "Option::is_none")]
        checkout_url: Option<String>,
        /// Projected meter name for the cache entry.
        #[serde(skip_serializing_if = "Option::is_none")]
        meter_name: Option<String>,
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
    /// Host reads the limits cache map (no TTL compare) and sends `limitsCacheEntry`.
    #[serde(rename_all = "camelCase")]
    ReadLimitsCache {
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
    /// Terminal allow. Host applies `cache` then proceeds.
    #[serde(rename_all = "camelCase")]
    Allow {
        /// Backend customer ref.
        customer_ref: String,
        /// Product reference.
        product: String,
        /// Meter name.
        meter_name: String,
        /// Last `checkLimits` body (or cached copy). Empty object when absent.
        limits: Value,
        /// Defaults already applied (`creditBalance ?? 0`, `withinLimits ?? true`).
        customer: CustomerSnapshot,
        /// Optional cache mutation.
        #[serde(skip_serializing_if = "Option::is_none")]
        cache: Option<GateCacheOp>,
    },
    /// Terminal gate. Host applies `cache` / `track` then returns the gate.
    #[serde(rename_all = "camelCase")]
    Gate {
        /// Backend customer ref.
        customer_ref: String,
        /// Product reference.
        product: String,
        /// Meter name.
        meter_name: String,
        /// Last `checkLimits` body (or cached copy). Empty object when absent.
        limits: Value,
        /// Defaults already applied (`creditBalance ?? 0`, `withinLimits ?? true`).
        customer: CustomerSnapshot,
        /// Assembled paywall gate.
        gate: PaywallGate,
        /// Optional cache mutation.
        #[serde(skip_serializing_if = "Option::is_none")]
        cache: Option<GateCacheOp>,
        /// Complete `trackUsage` body (`outcome: "paywall"`). Host POSTs this.
        request: Value,
    },
    /// Host POSTs `request` as `trackUsage` (success / fail / paywall).
    #[serde(rename_all = "camelCase")]
    EmitUsage {
        /// Complete `trackUsage` body.
        request: Value,
    },
    /// Handler failed with a paywall error — do not emit `outcome: "fail"`.
    SkipUsage,
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
                action: GateAction::ReadLimitsCache { key },
            })
        }
        "limitsCacheEntry" => on_limits_cache_entry(require_state(state)?, event),
        "limitsResult" => on_limits_result(require_state(state)?, event),
        "handlerSucceeded" => on_handler_succeeded(require_state(state)?, event),
        "handlerFailed" => on_handler_failed(require_state(state)?, event),
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
    let limits_cache_ttl_ms = event
        .get("limitsCacheTTLMs")
        .and_then(Value::as_i64)
        .unwrap_or(DEFAULT_LIMITS_CACHE_TTL_MS);
    let resolved = resolve_check_limits_params(Some(&product), None, usage_type)?;
    let mut state = GateDriverState {
        product: resolved.product_ref,
        meter_name: resolved.meter_name,
        original_customer_ref: customer_ref.clone(),
        backend_ref: None,
        started_ms,
        limits_key: None,
        limits_cache_ttl_ms,
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
                action: GateAction::ReadLimitsCache { key },
            })
        }
    }
}

/// Default `limitsCacheTTLMs` when `start` omits the override.
const DEFAULT_LIMITS_CACHE_TTL_MS: i64 = 10_000;
/// Frozen `trackUsage.actionType` (`defaults.usageActionType`).
const USAGE_ACTION_TYPE: &str = "api_call";
/// Frozen `trackUsage` request-id template (`defaults.requestIdFormat`).
const REQUEST_ID_FORMAT: &str = "solvapay_{epochMs}_{random9}";

fn render_request_id(now_ms: i64, random_unit: f64) -> String {
    REQUEST_ID_FORMAT
        .replace("{epochMs}", &now_ms.to_string())
        .replace("{random9}", &random9_from_f64(random_unit))
}

/// Handle a raw cache-map read. Rust owns freshness (`>=` TTL is stale).
fn on_limits_cache_entry(
    state: GateDriverState,
    event: &Value,
) -> Result<GateNextOutput, HelperErrorResult> {
    let found = event
        .get("found")
        .and_then(Value::as_bool)
        .ok_or_else(|| HelperErrorResult::transport("gate_next limitsCacheEntry.found is required"))?;
    let now_ms = event.get("nowMs").and_then(Value::as_i64).unwrap_or(0);
    if !found {
        return check_limits_action(state, None);
    }
    let timestamp_ms = event.get("timestampMs").and_then(Value::as_i64).ok_or_else(|| {
        HelperErrorResult::transport("gate_next limitsCacheEntry.timestampMs is required when found")
    })?;
    let age = now_ms.saturating_sub(timestamp_ms);
    if age >= state.limits_cache_ttl_ms {
        let delete_key = state.limits_key.clone();
        return check_limits_action(state, delete_key);
    }
    let remaining = require_f64(event, "remaining")?;
    let limits = event.get("limits").cloned().unwrap_or(json!({}));
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
    Ok(finish(state, eval.within_limits, limits, cache, now_ms, event)?)
}

/// Ask the host to call `checkLimits`, optionally deleting a stale cache key first.
fn check_limits_action(
    state: GateDriverState,
    cache_delete_key: Option<String>,
) -> Result<GateNextOutput, HelperErrorResult> {
    let customer_ref = state.backend_ref.clone().ok_or_else(|| {
        HelperErrorResult::transport("gate_next checkLimits without backendRef")
    })?;
    Ok(GateNextOutput {
        action: GateAction::CheckLimits {
            customer_ref,
            product_ref: state.product.clone(),
            meter_name: state.meter_name.clone(),
            include_checkout_session: true,
            cache_delete_key,
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
            checkout_url: limits
                .get("checkoutUrl")
                .and_then(Value::as_str)
                .map(str::to_owned),
            meter_name: Some(state.meter_name.clone()),
        })
    } else {
        None
    };
    Ok(finish(state, eval.within_limits, limits, cache, now_ms, event)?)
}

/// Handle a successful handler run: emit a complete `trackUsage` body.
fn on_handler_succeeded(
    state: GateDriverState,
    event: &Value,
) -> Result<GateNextOutput, HelperErrorResult> {
    let duration_ms = require_f64(event, "durationMs")?;
    let now_ms = event.get("nowMs").and_then(Value::as_i64).unwrap_or(0);
    let random_unit = require_f64(event, "randomUnit")?;
    let request = build_usage_request(&state, "success", duration_ms, now_ms, random_unit, None);
    Ok(GateNextOutput {
        state,
        action: GateAction::EmitUsage { request },
    })
}

/// Handle a failed handler run. Paywall errors do not count as `fail`.
fn on_handler_failed(
    state: GateDriverState,
    event: &Value,
) -> Result<GateNextOutput, HelperErrorResult> {
    let is_paywall_error = event
        .get("isPaywallError")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if is_paywall_error {
        return Ok(GateNextOutput {
            state,
            action: GateAction::SkipUsage,
        });
    }
    let duration_ms = require_f64(event, "durationMs")?;
    let now_ms = event.get("nowMs").and_then(Value::as_i64).unwrap_or(0);
    let random_unit = require_f64(event, "randomUnit")?;
    let error_message = event
        .get("errorMessage")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_owned);
    let request = build_usage_request(
        &state,
        "fail",
        duration_ms,
        now_ms,
        random_unit,
        error_message,
    );
    Ok(GateNextOutput {
        state,
        action: GateAction::EmitUsage { request },
    })
}

/// Build the terminal allow/gate action, optional cache write, and usage request.
fn finish(
    state: GateDriverState,
    within_limits: bool,
    limits: Value,
    cache: Option<GateCacheOp>,
    now_ms: i64,
    event: &Value,
) -> Result<GateNextOutput, HelperErrorResult> {
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
    let customer = customer_snapshot(&customer_ref, &limits);
    match decision {
        crate::paywall_decision::PaywallOutcome::Allow => Ok(GateNextOutput {
            action: GateAction::Allow {
                customer_ref,
                product: state.product.clone(),
                meter_name: state.meter_name.clone(),
                limits,
                customer,
                cache,
            },
            state,
        }),
        crate::paywall_decision::PaywallOutcome::Gate { gate } => {
            let random_unit = require_f64(event, "randomUnit")?;
            let request = build_usage_request(&state, "paywall", duration_ms, now_ms, random_unit, None);
            Ok(GateNextOutput {
                action: GateAction::Gate {
                    customer_ref,
                    product: state.product.clone(),
                    meter_name: state.meter_name.clone(),
                    limits,
                    customer,
                    gate,
                    cache,
                    request,
                },
                state,
            })
        }
    }
}

/// Render the complete `trackUsage` body, including request ID and timestamp.
fn build_usage_request(
    state: &GateDriverState,
    outcome: &str,
    duration_ms: f64,
    now_ms: i64,
    random_unit: f64,
    error_message: Option<String>,
) -> Value {
    let customer_ref = state
        .backend_ref
        .clone()
        .unwrap_or_else(|| state.original_customer_ref.clone());
    let request_id = render_request_id(now_ms, random_unit);
    let duration = if duration_ms.is_finite() && duration_ms.fract() == 0.0 {
        #[expect(clippy::cast_possible_truncation)]
        let whole = duration_ms as i64;
        json!(whole)
    } else {
        json!(duration_ms)
    };
    let mut request = json!({
        "customerRef": customer_ref,
        "actionType": USAGE_ACTION_TYPE,
        "units": 1,
        "outcome": outcome,
        "productRef": state.product,
        "duration": duration,
        "metadata": {
            "action": state.meter_name,
            "requestId": request_id,
        },
        "timestamp": iso8601_millis(now_ms),
    });
    if let Some(message) = error_message {
        if let Some(obj) = request.as_object_mut() {
            obj.insert("errorMessage".to_owned(), json!(message));
        }
    }
    request
}

/// Apply host-side snapshot defaults that used to live in five languages.
fn customer_snapshot(customer_ref: &str, limits: &Value) -> CustomerSnapshot {
    let obj = limits.as_object();
    CustomerSnapshot {
        customer_ref: customer_ref.to_owned(),
        balance: obj
            .and_then(|o| o.get("creditBalance"))
            .and_then(Value::as_f64)
            .unwrap_or(0.0),
        remaining: obj
            .and_then(|o| o.get("remaining"))
            .cloned()
            .unwrap_or(Value::Null),
        within_limits: obj
            .and_then(|o| o.get("withinLimits"))
            .and_then(Value::as_bool)
            .unwrap_or(true),
        plan: obj
            .and_then(|o| o.get("plan"))
            .cloned()
            .unwrap_or(Value::Null),
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
            GateAction::ReadLimitsCache { .. } => "readLimitsCache",
            GateAction::CheckLimits { .. } => "checkLimits",
            GateAction::Allow { .. } => "allow",
            GateAction::Gate { .. } => "gate",
            GateAction::EmitUsage { .. } => "emitUsage",
            GateAction::SkipUsage => "skipUsage",
        }
    }

    #[test]
    fn start_anonymous_skips_ensure() {
        let out = gate_next(None, Some(&start_event("anonymous"))).unwrap();
        assert_eq!(action_kind(&out), "readLimitsCache");
        match &out.action {
            GateAction::ReadLimitsCache { key } => {
                assert_eq!(key, "anonymous:prd_1:requests");
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn start_cus_skips_ensure() {
        let out = gate_next(None, Some(&start_event("cus_abc"))).unwrap();
        assert_eq!(action_kind(&out), "readLimitsCache");
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
                "kind": "limitsCacheEntry",
                "found": true,
                "remaining": 5,
                "limits": { "withinLimits": true, "remaining": 5, "checkoutUrl": "https://pay" },
                "timestampMs": 1_000,
                "nowMs": 1_010,
            })),
        )
        .unwrap();
        match &out.action {
            GateAction::Allow { cache, customer, .. } => {
                assert_eq!(customer.customer_ref, "cus_abc");
                assert_eq!(customer.balance, 0.0);
                assert!(customer.within_limits);
                assert_eq!(customer.remaining, json!(5));
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
                "kind": "limitsCacheEntry",
                "found": true,
                "remaining": 0,
                "limits": { "withinLimits": false, "remaining": 0 },
                "timestampMs": 1_000,
                "nowMs": 1_250,
                "randomUnit": 0.5,
            })),
        )
        .unwrap();
        match &out.action {
            GateAction::Gate {
                cache,
                request,
                gate,
                customer,
                ..
            } => {
                assert_eq!(gate.product, "prd_1");
                assert_eq!(customer.within_limits, false);
                assert!(matches!(cache, Some(GateCacheOp::Delete { .. })));
                assert_eq!(request["outcome"], "paywall");
                assert_eq!(request["duration"], 250);
                assert_eq!(request["actionType"], "api_call");
                assert_eq!(request["metadata"]["action"], "requests");
                assert_eq!(
                    request["metadata"]["requestId"],
                    "solvapay_1250_i"
                );
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
            Some(&json!({ "kind": "limitsCacheEntry", "found": false, "nowMs": 1_000 })),
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
                assert_eq!(cache_delete_key.as_deref(), None);
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn fresh_within_limits_allows_and_caches() {
        let started = gate_next(None, Some(&start_event("cus_abc"))).unwrap();
        let miss = gate_next(
            Some(&serde_json::to_value(&started.state).unwrap()),
            Some(&json!({ "kind": "limitsCacheEntry", "found": false })),
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
            GateAction::Allow { cache, .. } => {
                match cache {
                    Some(GateCacheOp::Set {
                        remaining,
                        timestamp,
                        checkout_url,
                        meter_name,
                        ..
                    }) => {
                        assert_eq!(*remaining, 2.0);
                        assert_eq!(*timestamp, 1_100);
                        assert_eq!(checkout_url.as_deref(), Some("https://pay"));
                        assert_eq!(meter_name.as_deref(), Some("requests"));
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
            Some(&json!({ "kind": "limitsCacheEntry", "found": false })),
        )
        .unwrap();
        let out = gate_next(
            Some(&serde_json::to_value(&miss.state).unwrap()),
            Some(&json!({
                "kind": "limitsResult",
                "limits": { "withinLimits": false, "remaining": 0 },
                "nowMs": 1_000,
                "randomUnit": 0.5,
            })),
        )
        .unwrap();
        match &out.action {
            GateAction::Gate { cache, request, .. } => {
                assert!(cache.is_none());
                assert_eq!(request["outcome"], "paywall");
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    fn allow_state() -> Value {
        let started = gate_next(None, Some(&start_event("cus_abc"))).unwrap();
        serde_json::to_value(&started.state).unwrap()
    }

    #[test]
    fn handler_succeeded_emits_success_request() {
        let out = gate_next(
            Some(&allow_state()),
            Some(&json!({
                "kind": "handlerSucceeded",
                "durationMs": 40,
                "nowMs": 1_040,
                "randomUnit": 0.5,
            })),
        )
        .unwrap();
        match &out.action {
            GateAction::EmitUsage { request } => {
                assert_eq!(request["outcome"], "success");
                assert_eq!(request["duration"], 40);
                assert_eq!(request["units"], 1);
                assert_eq!(request["actionType"], "api_call");
                assert_eq!(request["customerRef"], "cus_abc");
                assert_eq!(request["productRef"], "prd_1");
                assert_eq!(request["metadata"]["action"], "requests");
                assert_eq!(request["metadata"]["requestId"], "solvapay_1040_i");
                assert_eq!(request["timestamp"], "1970-01-01T00:00:01.040Z");
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn handler_failed_emits_fail_request() {
        let out = gate_next(
            Some(&allow_state()),
            Some(&json!({
                "kind": "handlerFailed",
                "durationMs": 12,
                "nowMs": 1_012,
                "randomUnit": 0.5,
                "errorMessage": "boom",
                "isPaywallError": false,
            })),
        )
        .unwrap();
        match &out.action {
            GateAction::EmitUsage { request } => {
                assert_eq!(request["outcome"], "fail");
                assert_eq!(request["errorMessage"], "boom");
                assert_eq!(request["metadata"]["requestId"], "solvapay_1012_i");
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn handler_failed_paywall_error_skips_usage() {
        let out = gate_next(
            Some(&allow_state()),
            Some(&json!({
                "kind": "handlerFailed",
                "durationMs": 12,
                "nowMs": 1_012,
                "randomUnit": 0.5,
                "isPaywallError": true,
            })),
        )
        .unwrap();
        assert_eq!(action_kind(&out), "skipUsage");
    }

    #[test]
    fn start_omitted_usage_type_defaults_to_requests() {
        let out = gate_next(
            None,
            Some(&json!({
                "kind": "start",
                "customerRef": "anonymous",
                "product": "prd_1",
                "startedMs": 1_000,
            })),
        )
        .unwrap();
        assert_eq!(out.state.meter_name, "requests");
        assert_eq!(action_kind(&out), "readLimitsCache");
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
            GateAction::ReadLimitsCache { key } => {
                assert_eq!(key, "cus_new:prd_1:requests");
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn cache_entry_at_ttl_is_stale_and_sets_delete_key() {
        let started = gate_next(None, Some(&start_event("cus_abc"))).unwrap();
        let state = serde_json::to_value(&started.state).unwrap();
        let out = gate_next(
            Some(&state),
            Some(&json!({
                "kind": "limitsCacheEntry",
                "found": true,
                "remaining": 5,
                "limits": { "withinLimits": true, "remaining": 5 },
                "timestampMs": 1_000,
                "nowMs": 11_000,
            })),
        )
        .unwrap();
        match &out.action {
            GateAction::CheckLimits { cache_delete_key, .. } => {
                assert_eq!(cache_delete_key.as_deref(), Some("cus_abc:prd_1:requests"));
            }
            other => panic!("unexpected {other:?}"),
        }
    }
}
