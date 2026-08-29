//! Pure usage helper decision/normalization cores (Step 30).

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::serde_util::{serialize_opt_whole_f64, serialize_whole_f64};

/// Usage snapshot projected from an active purchase (or none).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSnapshot {
    /// Meter name from `checkLimits`; explicit `null` when absent or uncapped.
    pub meter_ref: Option<String>,
    /// `used + remaining` when the meter has a finite cap; else `null`.
    #[serde(serialize_with = "serialize_opt_whole_f64")]
    pub total: Option<f64>,
    /// Units used (defaults to `0`).
    #[serde(serialize_with = "serialize_whole_f64")]
    pub used: f64,
    /// `max(0, total - used)` when `total` is known; else `null`.
    #[serde(serialize_with = "serialize_opt_whole_f64")]
    pub remaining: Option<f64>,
    /// 0–100 rounded to 2dp; `null` when `total` is unknown or zero.
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
/// Consumption (`used`, period window, `purchaseRef`) comes from the purchase.
/// The cap (`total`, `remaining`, `meterRef`) comes from `limits` when present —
/// `planSnapshot` no longer carries `limit` / `meterRef` on the wire.
///
/// `limits.remaining < 0` is the backend's uncapped sentinel.
///
/// # Arguments
///
/// * `active_purchase` - Purchase object or `None`/`Null`.
/// * `limits` - `checkLimits` payload (`remaining`, `meterName`) or `None`.
///
/// # Returns
///
/// Normalized usage snapshot (empty when no active purchase).
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
    let Some(purchase) = active_purchase.filter(|v| !v.is_null()) else {
        return UsageSnapshot {
            meter_ref: None,
            total: None,
            used: 0.0,
            remaining: None,
            percent_used: None,
            period_start: None,
            period_end: None,
            purchase_ref: None,
        };
    };

    let usage = purchase.get("usage");

    let used = usage
        .and_then(|u| u.get("used"))
        .and_then(Value::as_f64)
        .unwrap_or(0.0);

    let limits = limits.filter(|v| !v.is_null());
    let remaining_raw = limits
        .and_then(|l| l.get("remaining"))
        .and_then(Value::as_f64);
    let has_finite_cap = remaining_raw.is_some_and(|r| r >= 0.0);
    let remaining = if has_finite_cap { remaining_raw } else { None };
    let total = remaining.map(|r| used + r);
    let percent_used = total.and_then(|t| {
        if t > 0.0 {
            let pct = ((used / t) * 10_000.0).round() / 100.0;
            Some(pct.min(100.0))
        } else {
            None
        }
    });
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
        .get("reference")
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
    fn no_active_purchase() {
        let snap = project_usage_snapshot(None, None);
        assert_eq!(snap.meter_ref, None);
        assert_eq!(snap.total, None);
        assert_eq!(snap.used, 0.0);
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
        let limits = json!({ "meterName": "mtr_legacy", "remaining": 8 });
        let snap = project_usage_snapshot(Some(&purchase), Some(&limits));
        assert_eq!(snap.meter_ref.as_deref(), Some("mtr_legacy"));
        assert_eq!(snap.total, Some(10.0));
        assert_eq!(snap.used, 2.0);
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
        assert_eq!(snap.used, 5.0);
    }

    #[test]
    fn remaining_and_percent_clamp() {
        let purchase = json!({
            "reference": "pur_1",
            "usage": { "used": 50 }
        });
        let limits = json!({ "meterName": "mtr", "remaining": 0 });
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
        let limits = json!({ "meterName": "mtr", "remaining": 2 });
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
        let limits = json!({ "meterName": "mtr", "remaining": 19999 });
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
        assert_eq!(snap.total, Some(0.0));
        assert_eq!(snap.remaining, Some(0.0));
        assert_eq!(snap.percent_used, None);
    }

    #[test]
    fn skip_absent_periods() {
        let purchase = json!({
            "reference": "pur_1",
            "usage": { "used": 10, "periodStart": "2026-07-01T00:00:00Z" }
        });
        let limits = json!({ "meterName": "mtr", "remaining": 90 });
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
        let limits = json!({ "meterName": "mtr", "remaining": 1 });
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
        assert_eq!(snap.used, 5.0);
        assert_eq!(snap.purchase_ref.as_deref(), Some("pur_1"));
    }
}
