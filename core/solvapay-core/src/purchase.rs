//! Pure purchase helper decision cores (Step 29).

#![allow(clippy::missing_docs_in_private_items)]

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::serde_util::serialize_whole_f64;

/// JS-truthiness for JSON values (present, non-null, non-false, non-empty-string, non-zero).
pub(crate) fn is_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Value::String(s) => !s.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

/// JS-truthiness for optional string refs: [`None`] and `""` fail.
fn is_nonempty(value: Option<&str>) -> bool {
    value.is_some_and(|s| !s.is_empty())
}

/// Filter purchases to those with `status === "active"`.
///
/// # Arguments
///
/// * `purchases` - JSON array of purchase objects.
///
/// # Returns
///
/// Purchases whose `status` is exactly `"active"`.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "none",
    section = "purchase",
    emit_order = 19
)]
pub fn select_active_purchases(purchases: &[Value]) -> Vec<Value> {
    purchases
        .iter()
        .filter(|p| p.get("status").and_then(Value::as_str) == Some("active"))
        .cloned()
        .collect()
}

/// Fast-path predicate: cached customer is usable when `customerRef` is truthy
/// and `externalRef` is truthy and equals `user_id`.
///
/// Mirrors `customer && customer.customerRef` then
/// `customer.externalRef && customer.externalRef === userId`.
///
/// # Arguments
///
/// * `external_ref` - Customer `externalRef` field.
/// * `user_id` - Authenticated user id.
/// * `customer_ref` - Customer `customerRef` field.
///
/// # Returns
///
/// `true` when the cache entry is valid for this user.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "none",
    section = "purchase",
    emit_order = 17
)]
pub fn is_cached_customer_ref_valid(
    external_ref: Option<&str>,
    user_id: &str,
    customer_ref: Option<&str>,
) -> bool {
    if !is_nonempty(customer_ref) {
        return false;
    }
    matches!(external_ref, Some(ext) if !ext.is_empty() && ext == user_id)
}

/// Resolve response `customerRef` with JS-falsy fallback: `customerRef || userId`.
///
/// # Arguments
///
/// * `customer_ref` - Backend customer ref (may be empty/`None`).
/// * `user_id` - Authenticated user id fallback.
///
/// # Returns
///
/// The first truthy non-empty string.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "none",
    section = "purchase",
    emit_order = 18
)]
pub fn resolve_purchase_customer_ref(customer_ref: Option<&str>, user_id: &str) -> String {
    match customer_ref {
        Some(r) if !r.is_empty() => r.to_owned(),
        _ => user_id.to_owned(),
    }
}

/// Active plan purchase projected for the MCP account widget.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveProduct {
    /// Purchase reference.
    pub reference: String,
    /// Product display name.
    pub product_name: String,
    /// Product ref when present.
    pub product_ref: Option<String>,
    /// Frozen plan name.
    pub plan_name: Option<String>,
    /// Plan ref from the purchase or snapshot.
    pub plan_ref: Option<String>,
    /// Purchase start date.
    pub since: Option<String>,
    /// Snapshot `isMetered` flag.
    pub is_metered: bool,
    /// Purchase amount in minor units.
    #[serde(serialize_with = "serialize_whole_f64")]
    pub amount: f64,
    /// Purchase currency.
    pub currency: String,
}

fn is_plan_purchase(purchase: &Value) -> bool {
    if purchase.get("origin").and_then(Value::as_str) == Some("credit_topup")
        || purchase
            .pointer("/metadata/purpose")
            .and_then(Value::as_str)
            == Some("credit_topup")
    {
        return false;
    }
    purchase
        .get("planSnapshot")
        .is_some_and(|snap| !snap.is_null())
}

fn purchase_start_ms(purchase: &Value) -> f64 {
    purchase
        .get("startDate")
        .and_then(Value::as_str)
        .and_then(crate::utc::rfc3339_utc_ms)
        .unwrap_or(0.0)
}

fn is_paid_purchase(purchase: &Value) -> bool {
    purchase
        .get("amount")
        .and_then(Value::as_f64)
        .is_some_and(|amount| amount > 0.0)
}

/// Pick the customer's current plan purchase, or [`None`] if none match.
///
/// Filter: `status == "active"` (missing status is allowed), matching
/// `productRef` when given, `planSnapshot` present, and neither
/// `origin == "credit_topup"` nor `metadata.purpose == "credit_topup"`.
/// Rank by newest `startDate`; paid-over-free is only a same-timestamp tiebreak.
#[must_use]
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "none",
    section = "purchase",
    emit_order = 21
)]
pub fn select_active_plan_purchase(purchases: Option<&Value>, product_ref: Option<&str>) -> Option<Value> {
    let items = match purchases {
        Some(Value::Array(items)) => items,
        _ => return None,
    };
    let scope = product_ref.map(str::trim).filter(|s| !s.is_empty());
    let mut candidates: Vec<&Value> = items
        .iter()
        .filter(|purchase| {
            match purchase.get("status").and_then(Value::as_str) {
                Some("active") | None => true,
                Some(_) => false,
            }
        })
        .filter(|purchase| is_plan_purchase(purchase))
        .filter(|purchase| {
            scope.is_none_or(|want| purchase.get("productRef").and_then(Value::as_str) == Some(want))
        })
        .collect();
    if candidates.is_empty() {
        return None;
    }
    candidates.sort_by(|a, b| {
        let start = purchase_start_ms(b)
            .partial_cmp(&purchase_start_ms(a))
            .unwrap_or(std::cmp::Ordering::Equal);
        if start != std::cmp::Ordering::Equal {
            return start;
        }
        is_paid_purchase(b).cmp(&is_paid_purchase(a))
    });
    candidates.first().cloned().cloned()
}

/// Filter purchases to active plan rows for the account widget.
#[must_use]
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "none",
    section = "purchase",
    emit_order = 20
)]
pub fn derive_active_products(
    purchases: Option<&Value>,
    product_ref: Option<&str>,
) -> Vec<ActiveProduct> {
    let Some(Value::Array(items)) = purchases.filter(|v| !v.is_null()) else {
        return Vec::new();
    };
    let scope = product_ref.map(str::trim).filter(|s| !s.is_empty());
    items
        .iter()
        .filter(|purchase| is_plan_purchase(purchase))
        .filter(|purchase| {
            scope
                .is_none_or(|want| purchase.get("productRef").and_then(Value::as_str) == Some(want))
        })
        .map(|purchase| {
            let snapshot = purchase.get("planSnapshot").filter(|v| !v.is_null());
            ActiveProduct {
                reference: purchase
                    .get("reference")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                product_name: purchase
                    .get("productName")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
                    .unwrap_or("Product")
                    .to_owned(),
                product_ref: purchase
                    .get("productRef")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                plan_name: snapshot
                    .and_then(|s| s.get("name"))
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                plan_ref: purchase
                    .get("planRef")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
                    .map(str::to_owned)
                    .or_else(|| {
                        snapshot
                            .and_then(|s| s.get("reference"))
                            .and_then(Value::as_str)
                            .map(str::to_owned)
                    }),
                since: purchase
                    .get("startDate")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                is_metered: snapshot.and_then(|s| s.get("isMetered")) == Some(&Value::Bool(true)),
                amount: purchase
                    .get("amount")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0),
                currency: purchase
                    .get("currency")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
            }
        })
        .collect()
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
    fn select_active_mixed() {
        let purchases = vec![
            json!({ "reference": "pur_1", "status": "active" }),
            json!({ "reference": "pur_2", "status": "cancelled" }),
            json!({ "reference": "pur_3", "status": "active" }),
        ];
        let active = select_active_purchases(&purchases);
        assert_eq!(active.len(), 2);
        assert_eq!(active[0]["reference"], "pur_1");
        assert_eq!(active[1]["reference"], "pur_3");
    }

    #[test]
    fn select_active_empty() {
        assert!(select_active_purchases(&[]).is_empty());
    }

    #[test]
    fn select_active_none_active() {
        let purchases = vec![json!({ "reference": "pur_1", "status": "cancelled" })];
        assert!(select_active_purchases(&purchases).is_empty());
    }

    #[test]
    fn select_active_missing_status() {
        let purchases = vec![json!({ "reference": "pur_1" })];
        assert!(select_active_purchases(&purchases).is_empty());
    }

    #[test]
    fn cache_valid_match() {
        assert!(is_cached_customer_ref_valid(
            Some("user_123"),
            "user_123",
            Some("cus_ABC")
        ));
    }

    #[test]
    fn cache_mismatch() {
        assert!(!is_cached_customer_ref_valid(
            Some("user_other"),
            "user_123",
            Some("cus_ABC")
        ));
    }

    #[test]
    fn cache_missing_external_ref() {
        assert!(!is_cached_customer_ref_valid(
            None,
            "user_123",
            Some("cus_ABC")
        ));
    }

    #[test]
    fn cache_missing_customer_ref() {
        assert!(!is_cached_customer_ref_valid(
            Some("user_123"),
            "user_123",
            None
        ));
    }

    #[test]
    fn cache_empty_customer_ref() {
        assert!(!is_cached_customer_ref_valid(
            Some("user_123"),
            "user_123",
            Some("")
        ));
    }

    #[test]
    fn ref_uses_customer_ref() {
        assert_eq!(
            resolve_purchase_customer_ref(Some("cus_ABC"), "user_123"),
            "cus_ABC"
        );
    }

    #[test]
    fn ref_fallback_userid() {
        assert_eq!(resolve_purchase_customer_ref(None, "user_123"), "user_123");
        assert_eq!(
            resolve_purchase_customer_ref(Some(""), "user_123"),
            "user_123"
        );
    }

    #[test]
    fn is_truthy_matrix() {
        assert!(!is_truthy(&Value::Null));
        assert!(!is_truthy(&json!(false)));
        assert!(!is_truthy(&json!(0)));
        assert!(!is_truthy(&json!("")));
        assert!(is_truthy(&json!(true)));
        assert!(is_truthy(&json!(1)));
        assert!(is_truthy(&json!("x")));
        assert!(is_truthy(&json!({})));
        assert!(is_truthy(&json!([])));
    }
}
