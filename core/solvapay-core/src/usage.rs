//! Pure usage helper decision/normalization cores (Step 30).

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::serde_util::serialize_opt_whole_f64;

/// Usage snapshot projected from an active purchase (or none).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSnapshot {
    /// Meter name from `checkLimits`; explicit `null` when absent or uncapped.
    pub meter_ref: Option<String>,
    /// `limits.limit` when that value is `> 0`; else `null`. Never `used + remaining`.
    #[serde(serialize_with = "serialize_opt_whole_f64")]
    pub total: Option<f64>,
    /// Consumed units this period: `limits.used` when the backend measured it,
    /// else `total - remaining` when both are finite. `null` means this
    /// response did not measure consumption (`limits` null, unlimited, or
    /// credit-based).
    #[serde(serialize_with = "serialize_opt_whole_f64")]
    pub used: Option<f64>,
    /// `max(0, total - used)` when `total` is known; else `null`.
    #[serde(serialize_with = "serialize_opt_whole_f64")]
    pub remaining: Option<f64>,
    /// 0–100 rounded to 2dp; `null` when `total` is unknown or zero, or `used` is unknown.
    #[serde(serialize_with = "serialize_opt_whole_f64")]
    pub percent_used: Option<f64>,
    /// Billing period start (skip-absent).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub period_start: Option<String>,
    /// Billing period end (skip-absent).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub period_end: Option<String>,
    /// Purchase reference when an active purchase exists (skip-absent).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub purchase_ref: Option<String>,
}

/// Project an active purchase (and optional limits) into [`UsageSnapshot`].
///
/// Consumption comes from `limits.used` when present, else
/// `max(0, total - remaining)` when both are known, else it is unknown
/// (`null`). The purchase's own `usage.used` counter is retired and never
/// read: the backend only ever reset it to zero.
/// The cap (`total`) is `limits.limit` when `> 0` — never `used + remaining`.
/// `limits` absent means the cap is unknown, not unlimited. Unlimited is only
/// `limits.remaining == -1`.
///
/// # Arguments
///
/// * `active_purchase` - Purchase object or `None`/`Null`.
/// * `limits` - `checkLimits` payload (`remaining`, `meterName`) or `None`.
///
/// # Returns
///
/// Normalized usage snapshot. A null purchase still honors `limits`
/// (dev `deriveUsageSnapshot` contract).
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "none",
    section = "usage",
    emit_order = 25
)]
pub fn project_usage_snapshot(
    active_purchase: Option<&Value>,
    limits: Option<&Value>,
) -> UsageSnapshot {
    let purchase = active_purchase.filter(|v| !v.is_null());
    let usage = purchase.and_then(|p| p.get("usage"));
    let limits = limits.filter(|v| !v.is_null());
    let remaining_raw = limits
        .and_then(|l| l.get("remaining"))
        .and_then(Value::as_f64);
    let has_finite_cap = remaining_raw.is_some_and(|r| r >= 0.0);
    let remaining = if has_finite_cap { remaining_raw } else { None };
    let total = limits
        .and_then(|l| l.get("limit"))
        .and_then(Value::as_f64)
        .filter(|limit| *limit > 0.0);
    let used = limits
        .and_then(|l| l.get("used"))
        .and_then(Value::as_f64)
        .or_else(|| match (total, remaining) {
            (Some(total), Some(remaining)) => Some((total - remaining).max(0.0)),
            _ => None,
        });
    let percent_used = match (total, used) {
        (Some(t), Some(u)) if t > 0.0 => {
            let pct = ((u / t) * 10_000.0).round() / 100.0;
            Some(pct.min(100.0))
        }
        _ => None,
    };
    let meter_ref = limits
        .and_then(|l| l.get("meterName").or_else(|| l.get("meterRef")))
        .and_then(Value::as_str)
        .map(str::to_owned);

    let period_start = usage
        .and_then(|u| u.get("periodStart"))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_owned);
    let period_end = usage
        .and_then(|u| u.get("periodEnd"))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_owned);

    let purchase_ref = purchase
        .and_then(|p| p.get("reference"))
        .and_then(Value::as_str)
        .map(str::to_owned);

    UsageSnapshot {
        meter_ref,
        total,
        used,
        remaining,
        percent_used,
        period_start,
        period_end,
        purchase_ref,
    }
}

/// Whether a `trackUsage` failure should be retried.
///
/// Matches the TypeScript host predicate `error.message.includes('Customer not found')`.
///
/// # Arguments
///
/// * `message` - Error message string from the failed `trackUsage` call.
///
/// # Returns
///
/// `true` when the message contains `Customer not found`.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "none",
    section = "usage",
    emit_order = 26
)]
pub fn should_retry_usage_error(message: &str) -> bool {
    message.contains("Customer not found")
}

/// Whether a purchase should pay for a `checkLimits` round trip.
///
/// A snapshot counts as metered when it sets `isMetered`, or when
/// [`crate::pricing_options::counts_usage`] sees a per-unit charge, a limit,
/// or a tier. Hosts must not re-derive this.
///
/// # Arguments
///
/// * `purchase` - Purchase object, or `None`/`Null` when none is active.
///
/// # Returns
///
/// `true` when the plan snapshot is metered.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "none",
    section = "usage",
    emit_order = 27
)]
pub fn purchase_usage_is_metered(purchase: Option<&Value>) -> bool {
    let Some(purchase) = purchase.filter(|value| !value.is_null()) else {
        return false;
    };
    let Some(snapshot) = purchase
        .get("planSnapshot")
        .filter(|value| !value.is_null())
    else {
        return false;
    };
    snapshot.get("isMetered") == Some(&Value::Bool(true))
        || crate::pricing_options::counts_usage(Some(snapshot))
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
    fn metered_flag_or_counted_usage_requests_limits() {
        let flagged = json!({ "planSnapshot": { "isMetered": true } });
        let counted = json!({
            "planSnapshot": {
                "isMetered": false,
                "options": [{
                    "kind": "limit",
                    "cap": 3,
                    "scope": "billing_period",
                    "meter": "tokens",
                    "onExceed": "block"
                }]
            }
        });
        let flat = json!({ "planSnapshot": { "isMetered": false } });
        assert!(purchase_usage_is_metered(Some(&flagged)));
        assert!(purchase_usage_is_metered(Some(&counted)));
        assert!(!purchase_usage_is_metered(Some(&flat)));
        assert!(!purchase_usage_is_metered(None));
    }

    #[test]
    fn no_active_purchase() {
        let snap = project_usage_snapshot(None, None);
        assert_eq!(snap.meter_ref, None);
        assert_eq!(snap.total, None);
        assert_eq!(snap.used, None);
        assert_eq!(snap.remaining, None);
        assert_eq!(snap.percent_used, None);
        assert_eq!(snap.purchase_ref, None);
    }

    #[test]
    fn cap_from_limits_not_plan_snapshot() {
        let purchase = json!({
            "reference": "pur_1",
            "planSnapshot": { "isMetered": true },
            "usage": { "used": 2 }
        });
        let limits = json!({ "meterName": "mtr_legacy", "remaining": 8, "limit": 10, "used": 2 });
        let snap = project_usage_snapshot(Some(&purchase), Some(&limits));
        assert_eq!(snap.meter_ref.as_deref(), Some("mtr_legacy"));
        assert_eq!(snap.total, Some(10.0));
        assert_eq!(snap.used, Some(2.0));
        assert_eq!(snap.remaining, Some(8.0));
        assert_eq!(snap.percent_used, Some(20.0));
        assert_eq!(snap.purchase_ref.as_deref(), Some("pur_1"));
    }

    #[test]
    fn uncapped_sentinel_nulls_total() {
        let purchase = json!({
            "reference": "pur_1",
            "usage": { "used": 5 }
        });
        let limits = json!({ "meterName": "mtr", "remaining": -1 });
        let snap = project_usage_snapshot(Some(&purchase), Some(&limits));
        assert_eq!(snap.meter_ref.as_deref(), Some("mtr"));
        assert_eq!(snap.total, None);
        assert_eq!(snap.remaining, None);
        assert_eq!(snap.percent_used, None);
        // Unlimited: consumption was not measured, and the retired purchase
        // counter must not stand in for it.
        assert_eq!(snap.used, None);
    }

    #[test]
    fn remaining_and_percent_clamp() {
        let purchase = json!({
            "reference": "pur_1",
            "usage": { "used": 50 }
        });
        let limits = json!({ "meterName": "mtr", "remaining": 0, "limit": 50, "used": 50 });
        let snap = project_usage_snapshot(Some(&purchase), Some(&limits));
        assert_eq!(snap.remaining, Some(0.0));
        assert_eq!(snap.percent_used, Some(100.0));
        assert_eq!(snap.total, Some(50.0));
    }

    #[test]
    fn fractional_percent_round() {
        let purchase = json!({
            "reference": "pur_1",
            "usage": { "used": 1 }
        });
        let limits = json!({ "meterName": "mtr", "remaining": 2, "limit": 3 });
        let snap = project_usage_snapshot(Some(&purchase), Some(&limits));
        assert_eq!(snap.percent_used, Some(33.33));
    }

    #[test]
    fn half_up_rounding_case() {
        // (1/20000)*10000 = 0.5 → Math.round half-up → 1 → percentUsed 0.01
        let purchase = json!({
            "reference": "pur_1",
            "usage": { "used": 1 }
        });
        let limits = json!({ "meterName": "mtr", "remaining": 19999, "limit": 20000, "used": 1 });
        let snap = project_usage_snapshot(Some(&purchase), Some(&limits));
        assert_eq!(snap.percent_used, Some(0.01));
    }

    #[test]
    fn total_zero_null_percent() {
        let purchase = json!({
            "reference": "pur_1",
            "usage": { "used": 0 }
        });
        let limits = json!({ "meterName": "mtr", "remaining": 0 });
        let snap = project_usage_snapshot(Some(&purchase), Some(&limits));
        assert_eq!(snap.total, None);
        assert_eq!(snap.remaining, Some(0.0));
        assert_eq!(snap.percent_used, None);
    }

    #[test]
    fn skip_absent_periods() {
        let purchase = json!({
            "reference": "pur_1",
            "usage": { "used": 10, "periodStart": "2026-07-01T00:00:00Z" }
        });
        let limits = json!({ "meterName": "mtr", "remaining": 90, "limit": 100, "used": 10 });
        let snap = project_usage_snapshot(Some(&purchase), Some(&limits));
        let value = serde_json::to_value(&snap).unwrap();
        assert_eq!(value["periodStart"], "2026-07-01T00:00:00Z");
        assert!(value.get("periodEnd").is_none());
    }

    #[test]
    fn whole_percent_emits_integer() {
        let purchase = json!({
            "reference": "pur_1",
            "usage": { "used": 1 }
        });
        let limits = json!({ "meterName": "mtr", "remaining": 1, "limit": 2 });
        let snap = project_usage_snapshot(Some(&purchase), Some(&limits));
        let value = serde_json::to_value(&snap).unwrap();
        assert_eq!(value["percentUsed"], json!(50));
        assert!(value["percentUsed"].as_i64().is_some());
    }

    #[test]
    fn retries_customer_not_found() {
        assert!(should_retry_usage_error("404 - Customer not found"));
        assert!(should_retry_usage_error("Customer not found"));
        assert!(!should_retry_usage_error("customer not found"));
        assert!(!should_retry_usage_error("timeout"));
    }

    #[test]
    fn purchase_without_limits_has_no_cap() {
        let purchase = json!({
            "reference": "pur_1",
            "planSnapshot": { "isMetered": false },
            "usage": { "used": 5 }
        });
        let snap = project_usage_snapshot(Some(&purchase), None);
        assert_eq!(snap.meter_ref, None);
        assert_eq!(snap.total, None);
        // `limits` absent: consumption was not measured.
        assert_eq!(snap.used, None);
        assert_eq!(snap.percent_used, None);
        assert_eq!(snap.purchase_ref.as_deref(), Some("pur_1"));
        let value = serde_json::to_value(&snap).unwrap();
        assert!(value["used"].is_null());
    }

    #[test]
    fn used_derives_from_cap_minus_remaining() {
        let limits = json!({ "remaining": 1, "limit": 3 });
        let snap = project_usage_snapshot(None, Some(&limits));
        assert_eq!(snap.total, Some(3.0));
        assert_eq!(snap.used, Some(2.0));
        assert_eq!(snap.percent_used, Some(66.67));
    }

    #[test]
    fn used_unknown_when_backend_supplied_neither_used_nor_limit() {
        // Credit-based and uncapped responses carry `remaining` only.
        let limits = json!({ "remaining": 3800, "meterName": "requests" });
        let snap = project_usage_snapshot(None, Some(&limits));
        assert_eq!(snap.meter_ref.as_deref(), Some("requests"));
        assert_eq!(snap.total, None);
        assert_eq!(snap.used, None);
        assert_eq!(snap.remaining, Some(3800.0));
        assert_eq!(snap.percent_used, None);
    }

    #[test]
    fn measured_used_wins_and_serializes_whole() {
        let limits = json!({ "remaining": 3800, "meterName": "requests", "used": 6200, "limit": 10000 });
        let snap = project_usage_snapshot(None, Some(&limits));
        assert_eq!(snap.used, Some(6200.0));
        assert_eq!(snap.percent_used, Some(62.0));
        let value = serde_json::to_value(&snap).unwrap();
        assert_eq!(value["used"], json!(6200));
        assert!(value["used"].as_i64().is_some());
    }
}
