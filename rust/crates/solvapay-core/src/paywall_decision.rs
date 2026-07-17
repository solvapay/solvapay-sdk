//! Pure paywall decision cores (Step 32).
//!
//! Limit evaluation and [`PaywallOutcome`] production. Cache Map/TTL,
//! ensureCustomer, checkLimits HTTP, and trackUsage stay host-side.
//! Gate assembly reuses [`build_paywall_gate`] (step 14).

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::paywall_gate::{build_paywall_gate, PaywallGate, PaywallGateLimits};
use crate::serde_util::serialize_whole_f64;

/// Cache-hit path evaluation (host applies `evict` to the Map).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedLimitsEvaluation {
    /// Whether the request is within limits.
    pub within_limits: bool,
    /// Remaining after optimistic decrement (or `0` on the block-once path).
    #[serde(serialize_with = "serialize_whole_f64")]
    pub remaining: f64,
    /// When true, host must delete the cache entry.
    pub evict: bool,
}

/// Cache-miss path evaluation after `checkLimits` returns.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FreshLimitsEvaluation {
    /// Whether the request is within limits.
    pub within_limits: bool,
    /// Remaining after optimistic consume (unchanged when not consumed).
    #[serde(serialize_with = "serialize_whole_f64")]
    pub remaining: f64,
    /// When true, host should write the decremented entry into the cache.
    pub should_cache: bool,
}

/// Decision-point outcome (`allow` or `gate` with assembled gate).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "outcome", rename_all = "camelCase")]
pub enum PaywallOutcome {
    /// Request may proceed.
    Allow,
    /// Request is gated; `gate` is the transport-agnostic structured content.
    Gate {
        /// Assembled paywall gate (skip-absent on the allow arm via enum shape).
        gate: PaywallGate,
    },
}

/// Resolve product ref with JS `||` falsy semantics (empty string falls through).
///
/// # Arguments
///
/// * `metadata_product` - Product from paywall metadata.
/// * `env_product` - Product from host env (`SOLVAPAY_PRODUCT`).
///
/// # Returns
///
/// Resolved product reference string.
pub fn resolve_product_ref(metadata_product: Option<&str>, env_product: Option<&str>) -> String {
    js_or_str(metadata_product)
        .or_else(|| js_or_str(env_product))
        .unwrap_or_else(|| "default-product".to_owned())
}

/// Evaluate a fresh cache-hit `remaining` value.
///
/// # Arguments
///
/// * `remaining` - Cached remaining allowance.
///
/// # Returns
///
/// Within-limits flag, post-decrement remaining, and whether to evict.
pub fn evaluate_cached_limits(remaining: f64) -> CachedLimitsEvaluation {
    if remaining > 0.0 {
        let next = remaining - 1.0;
        return CachedLimitsEvaluation {
            within_limits: true,
            remaining: next,
            evict: next <= 0.0,
        };
    }
    CachedLimitsEvaluation {
        within_limits: false,
        remaining: 0.0,
        evict: true,
    }
}

/// Evaluate a fresh `checkLimits` response (pre-request allowance).
///
/// # Arguments
///
/// * `within_limits` - Backend `withinLimits` flag.
/// * `remaining` - Backend pre-request remaining.
///
/// # Returns
///
/// Updated within/remaining and whether the host should cache.
pub fn evaluate_fresh_limits(within_limits: bool, remaining: f64) -> FreshLimitsEvaluation {
    let consumed_allowance = within_limits && remaining > 0.0;
    if consumed_allowance {
        return FreshLimitsEvaluation {
            within_limits: true,
            remaining: (remaining - 1.0).max(0.0),
            should_cache: true,
        };
    }
    FreshLimitsEvaluation {
        within_limits,
        remaining,
        should_cache: false,
    }
}

/// Produce allow vs gate at the decision point.
///
/// # Arguments
///
/// * `within_limits` - Resolved within-limits flag after cache/fresh evaluation.
/// * `product` - Resolved product reference.
/// * `limits` - `LimitResponseWithPlan` JSON (or `None`/`Null` for fallback).
/// * `checkout_url` - Feeds fallback-limits synthesis when `limits` is absent.
///   Presence (including empty string) is preserved; absent means skip-absent.
///
/// # Returns
///
/// [`PaywallOutcome::Allow`] or [`PaywallOutcome::Gate`] with assembled gate.
pub fn decide_paywall_outcome(
    within_limits: bool,
    product: &str,
    limits: Option<&Value>,
    checkout_url: Option<&str>,
) -> PaywallOutcome {
    if within_limits {
        return PaywallOutcome::Allow;
    }

    let gate_limits = match limits.filter(|v| !v.is_null()) {
        Some(value) => match serde_json::from_value::<PaywallGateLimits>(value.clone()) {
            Ok(parsed) => parsed,
            Err(_) => resolve_fallback_gate_limits(checkout_url),
        },
        None => resolve_fallback_gate_limits(checkout_url),
    };

    PaywallOutcome::Gate {
        gate: build_paywall_gate(product, &gate_limits),
    }
}

/// JS `||` string: `None` / empty → absent.
fn js_or_str(value: Option<&str>) -> Option<String> {
    value.filter(|s| !s.is_empty()).map(str::to_owned)
}

/// Synthesize fallback limits when `lastLimitsCheck` is absent on a gate path.
///
/// `checkout_url` is skip-absent (`Some` including empty string is preserved).
fn resolve_fallback_gate_limits(checkout_url: Option<&str>) -> PaywallGateLimits {
    PaywallGateLimits {
        remaining: Some(0.0),
        plan: Some(String::new()),
        checkout_url: checkout_url.map(str::to_owned),
        ..PaywallGateLimits::default()
    }
}

#[cfg(test)]
mod tests {
    #![allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::missing_docs_in_private_items
    )]

    use super::*;
    use serde_json::json;

    #[test]
    fn resolve_metadata_wins() {
        assert_eq!(
            resolve_product_ref(Some("prd_meta"), Some("prd_env")),
            "prd_meta"
        );
    }

    #[test]
    fn resolve_env_fallback() {
        assert_eq!(resolve_product_ref(None, Some("prd_env")), "prd_env");
    }

    #[test]
    fn resolve_default() {
        assert_eq!(resolve_product_ref(None, None), "default-product");
    }

    #[test]
    fn resolve_empty_string_falls_through() {
        assert_eq!(resolve_product_ref(Some(""), Some("prd_env")), "prd_env");
    }

    #[test]
    fn cached_remaining_5() {
        let ev = evaluate_cached_limits(5.0);
        assert!(ev.within_limits);
        assert_eq!(ev.remaining, 4.0);
        assert!(!ev.evict);
    }

    #[test]
    fn cached_remaining_1_evicts() {
        let ev = evaluate_cached_limits(1.0);
        assert!(ev.within_limits);
        assert_eq!(ev.remaining, 0.0);
        assert!(ev.evict);
    }

    #[test]
    fn cached_remaining_0_blocks_and_evicts() {
        let ev = evaluate_cached_limits(0.0);
        assert!(!ev.within_limits);
        assert_eq!(ev.remaining, 0.0);
        assert!(ev.evict);
    }

    #[test]
    fn fresh_within_remaining_3_consumes_and_caches() {
        let ev = evaluate_fresh_limits(true, 3.0);
        assert!(ev.within_limits);
        assert_eq!(ev.remaining, 2.0);
        assert!(ev.should_cache);
    }

    #[test]
    fn fresh_within_remaining_0_no_cache() {
        let ev = evaluate_fresh_limits(true, 0.0);
        assert!(ev.within_limits);
        assert_eq!(ev.remaining, 0.0);
        assert!(!ev.should_cache);
    }

    #[test]
    fn fresh_not_within() {
        let ev = evaluate_fresh_limits(false, 0.0);
        assert!(!ev.within_limits);
        assert_eq!(ev.remaining, 0.0);
        assert!(!ev.should_cache);
    }

    #[test]
    fn decide_allow() {
        let outcome = decide_paywall_outcome(
            true,
            "prd_demo",
            Some(&json!({ "withinLimits": true, "remaining": 5, "plan": "free" })),
            None,
        );
        assert_eq!(outcome, PaywallOutcome::Allow);
    }

    #[test]
    fn decide_gate_fallback_without_checkout_skips_key() {
        let outcome = decide_paywall_outcome(false, "prd_demo", None, None);
        let PaywallOutcome::Gate { gate } = outcome else {
            panic!("expected gate");
        };
        let value = serde_json::to_value(&gate).unwrap();
        assert_eq!(value["kind"], "payment_required");
        assert_eq!(value["checkoutUrl"], "");
        // Fallback plan is empty string; message is upgrade copy without URL.
        assert!(value["message"].as_str().unwrap().contains("upgrade"));
    }

    #[test]
    fn decide_gate_fallback_with_checkout() {
        let outcome = decide_paywall_outcome(false, "prd_demo", None, Some("https://pay.test/x"));
        let PaywallOutcome::Gate { gate } = outcome else {
            panic!("expected gate");
        };
        assert_eq!(gate.checkout_url, "https://pay.test/x");
    }

    #[test]
    fn whole_remaining_emits_json_integer() {
        let ev = evaluate_cached_limits(5.0);
        let value = serde_json::to_value(&ev).unwrap();
        assert_eq!(value["remaining"], 4);
        assert!(value["remaining"].is_i64() || value["remaining"].is_u64());
    }

    #[test]
    fn fallback_limits_helper_skips_absent_checkout() {
        let limits = resolve_fallback_gate_limits(None);
        assert_eq!(limits.checkout_url, None);
        assert_eq!(limits.plan.as_deref(), Some(""));
        assert_eq!(limits.remaining, Some(0.0));
    }
}
