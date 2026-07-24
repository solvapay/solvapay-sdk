//! Pure purchase helper decision cores (Step 29).

use serde_json::Value;

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
pub fn resolve_purchase_customer_ref(customer_ref: Option<&str>, user_id: &str) -> String {
    match customer_ref {
        Some(r) if !r.is_empty() => r.to_owned(),
        _ => user_id.to_owned(),
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
