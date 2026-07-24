//! Pure usage helper decision/normalization cores (Step 30).

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::serde_util::{serialize_opt_whole_f64, serialize_whole_f64};

/// Usage snapshot projected from an active purchase (or none).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSnapshot {
    /// Meter reference (`meterRef` / `meterId` fallback); explicit `null` when absent.
    pub meter_ref: Option<String>,
    /// Plan limit; explicit `null` when absent.
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

/// Project an active purchase JSON object (or `null`) into [`UsageSnapshot`].
///
/// # Arguments
///
/// * `active_purchase` - Purchase object or `None`/`Null`.
///
/// # Returns
///
/// Normalized usage snapshot (empty when no active purchase).
pub fn project_usage_snapshot(active_purchase: Option<&Value>) -> UsageSnapshot {
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

    let snap = purchase.get("planSnapshot");
    let usage = purchase.get("usage");

    let meter_ref = snap
        .and_then(|s| {
            s.get("meterRef")
                .and_then(Value::as_str)
                .or_else(|| s.get("meterId").and_then(Value::as_str))
        })
        .map(str::to_owned);

    let total = snap.and_then(|s| s.get("limit")).and_then(Value::as_f64);

    let used = usage
        .and_then(|u| u.get("used"))
        .and_then(Value::as_f64)
        .unwrap_or(0.0);

    let remaining = total.map(|t| (t - used).max(0.0));
    let percent_used = total.and_then(|t| {
        if t > 0.0 {
            let pct = ((used / t) * 10_000.0).round() / 100.0;
            Some(pct.min(100.0))
        } else {
            None
        }
    });

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
        let snap = project_usage_snapshot(None);
        assert_eq!(snap.meter_ref, None);
        assert_eq!(snap.total, None);
        assert_eq!(snap.used, 0.0);
        assert_eq!(snap.remaining, None);
        assert_eq!(snap.percent_used, None);
        assert_eq!(snap.purchase_ref, None);
    }

    #[test]
    fn meter_id_fallback() {
        let purchase = json!({
            "reference": "pur_1",
            "planSnapshot": { "meterId": "mtr_legacy", "limit": 10 },
            "usage": { "used": 2 }
        });
        let snap = project_usage_snapshot(Some(&purchase));
        assert_eq!(snap.meter_ref.as_deref(), Some("mtr_legacy"));
        assert_eq!(snap.total, Some(10.0));
        assert_eq!(snap.used, 2.0);
        assert_eq!(snap.remaining, Some(8.0));
        assert_eq!(snap.percent_used, Some(20.0));
        assert_eq!(snap.purchase_ref.as_deref(), Some("pur_1"));
    }

    #[test]
    fn remaining_and_percent_clamp() {
        let purchase = json!({
            "reference": "pur_1",
            "planSnapshot": { "meterRef": "mtr", "limit": 10 },
            "usage": { "used": 50 }
        });
        let snap = project_usage_snapshot(Some(&purchase));
        assert_eq!(snap.remaining, Some(0.0));
        assert_eq!(snap.percent_used, Some(100.0));
    }

    #[test]
    fn fractional_percent_round() {
        let purchase = json!({
            "reference": "pur_1",
            "planSnapshot": { "meterRef": "mtr", "limit": 3 },
            "usage": { "used": 1 }
        });
        let snap = project_usage_snapshot(Some(&purchase));
        assert_eq!(snap.percent_used, Some(33.33));
    }

    #[test]
    fn half_up_rounding_case() {
        // (1/20000)*10000 = 0.5 → Math.round half-up → 1 → percentUsed 0.01
        let purchase = json!({
            "reference": "pur_1",
            "planSnapshot": { "meterRef": "mtr", "limit": 20000 },
            "usage": { "used": 1 }
        });
        let snap = project_usage_snapshot(Some(&purchase));
        assert_eq!(snap.percent_used, Some(0.01));
    }

    #[test]
    fn total_zero_null_percent() {
        let purchase = json!({
            "reference": "pur_1",
            "planSnapshot": { "meterRef": "mtr", "limit": 0 },
            "usage": { "used": 0 }
        });
        let snap = project_usage_snapshot(Some(&purchase));
        assert_eq!(snap.total, Some(0.0));
        assert_eq!(snap.remaining, Some(0.0));
        assert_eq!(snap.percent_used, None);
    }

    #[test]
    fn skip_absent_periods() {
        let purchase = json!({
            "reference": "pur_1",
            "planSnapshot": { "meterRef": "mtr", "limit": 100 },
            "usage": { "used": 10, "periodStart": "2026-07-01T00:00:00Z" }
        });
        let snap = project_usage_snapshot(Some(&purchase));
        let value = serde_json::to_value(&snap).unwrap();
        assert_eq!(value["periodStart"], "2026-07-01T00:00:00Z");
        assert!(value.get("periodEnd").is_none());
    }

    #[test]
    fn whole_percent_emits_integer() {
        let purchase = json!({
            "reference": "pur_1",
            "planSnapshot": { "meterRef": "mtr", "limit": 2 },
            "usage": { "used": 1 }
        });
        let snap = project_usage_snapshot(Some(&purchase));
        let value = serde_json::to_value(&snap).unwrap();
        assert_eq!(value["percentUsed"], json!(50));
        assert!(value["percentUsed"].as_i64().is_some());
    }
}
