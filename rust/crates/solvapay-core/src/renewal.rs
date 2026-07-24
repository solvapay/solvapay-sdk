//! Pure renewal helper decision/normalization cores (Step 29).

use serde_json::Value;

use crate::helper_error::HelperErrorResult;
use crate::purchase::is_truthy;

/// Frozen 400 when purchaseRef is missing or empty.
const PURCHASE_REF_REQUIRED: &str = "Missing required parameter: purchaseRef is required";
/// Frozen 500 for non-object cancel responses.
const CANCEL_INVALID: &str = "Invalid response from cancel purchase endpoint";
/// Frozen 500 when cancel response lacks reference.
const CANCEL_MISSING_FIELDS: &str = "Cancel purchase response missing required fields";
/// Frozen 500 for non-object reactivate responses.
const REACTIVATE_INVALID: &str = "Invalid response from reactivate purchase endpoint";
/// Frozen 500 when reactivate response lacks reference.
const REACTIVATE_MISSING_FIELDS: &str = "Reactivate purchase response missing required fields";
/// Frozen 500 when reactivate left cancelledAt set.
const REACTIVATE_CANCELLED_AT_STILL_SET: &str =
    "Purchase reactivation failed: cancelledAt is still set";
/// Frozen 404 for not-found classification.
const PURCHASE_NOT_FOUND: &str = "Purchase not found";
/// Frozen 400 for cancel ownership/cancellability classification.
const CANCEL_CANNOT: &str = "Purchase cannot be cancelled or does not belong to provider";
/// Frozen 400 for reactivate classification.
const REACTIVATE_CANNOT: &str = "Purchase cannot be reactivated";

/// JS-truthiness for string refs: [`None`] and `""` fail.
fn is_nonempty(value: Option<&str>) -> bool {
    value.is_some_and(|s| !s.is_empty())
}

/// Validate purchaseRef (JS truthiness: empty string fails).
///
/// # Arguments
///
/// * `purchase_ref` - Purchase reference; empty/`None` fails.
///
/// # Returns
///
/// [`None`] when present and non-empty; otherwise the frozen 400.
pub fn validate_purchase_ref(purchase_ref: Option<&str>) -> Option<HelperErrorResult> {
    if is_nonempty(purchase_ref) {
        None
    } else {
        Some(HelperErrorResult::without_details(
            PURCHASE_REF_REQUIRED,
            400,
        ))
    }
}

/// Format status for the dynamic cancel-not-cancelled message (JS template parity).
///
/// Missing → `"undefined"`; `null` → `"null"`; strings as-is; other JSON as `to_string()`.
fn format_status_for_message(status: Option<&Value>) -> String {
    match status {
        None => "undefined".to_owned(),
        Some(Value::Null) => "null".to_owned(),
        Some(Value::String(s)) => s.clone(),
        Some(other) => other.to_string(),
    }
}

/// Shared unwrap of optional nested `.purchase` object.
///
/// Returns [`None`] when the top-level value is not an object.
fn unwrap_purchase(response: &Value) -> Option<&Value> {
    if !response.is_object() {
        return None;
    }
    match response.get("purchase") {
        Some(inner) if inner.is_object() => Some(inner),
        _ => Some(response),
    }
}

/// Normalize a cancel-purchase API response.
///
/// Unwraps nested `.purchase`, requires truthy `reference`, and requires
/// `status === "cancelled"` or truthy `cancelledAt`.
///
/// # Arguments
///
/// * `response` - Raw API JSON value.
///
/// # Returns
///
/// The unwrapped purchase object, or a frozen helper error.
pub fn normalize_cancel_response(response: &Value) -> Result<Value, HelperErrorResult> {
    let Some(purchase) = unwrap_purchase(response) else {
        return Err(HelperErrorResult::without_details(CANCEL_INVALID, 500));
    };

    let reference = purchase.get("reference");
    if reference.is_none_or(|r| !is_truthy(r)) {
        return Err(HelperErrorResult::without_details(
            CANCEL_MISSING_FIELDS,
            500,
        ));
    }

    let status = purchase.get("status");
    let is_cancelled = status.and_then(Value::as_str) == Some("cancelled")
        || purchase.get("cancelledAt").is_some_and(is_truthy);

    if !is_cancelled {
        let status_display = format_status_for_message(status);
        return Err(HelperErrorResult::without_details(
            format!(
                "Purchase cancellation failed: backend returned status '{status_display}' without cancelledAt timestamp"
            ),
            500,
        ));
    }

    Ok(purchase.clone())
}

/// Normalize a reactivate-purchase API response.
///
/// Unwraps nested `.purchase`, requires truthy `reference`, and rejects
/// truthy `cancelledAt`.
///
/// # Arguments
///
/// * `response` - Raw API JSON value.
///
/// # Returns
///
/// The unwrapped purchase object, or a frozen helper error.
pub fn normalize_reactivate_response(response: &Value) -> Result<Value, HelperErrorResult> {
    let Some(purchase) = unwrap_purchase(response) else {
        return Err(HelperErrorResult::without_details(REACTIVATE_INVALID, 500));
    };

    let reference = purchase.get("reference");
    if reference.is_none_or(|r| !is_truthy(r)) {
        return Err(HelperErrorResult::without_details(
            REACTIVATE_MISSING_FIELDS,
            500,
        ));
    }

    if purchase.get("cancelledAt").is_some_and(is_truthy) {
        return Err(HelperErrorResult::without_details(
            REACTIVATE_CANCELLED_AT_STILL_SET,
            500,
        ));
    }

    Ok(purchase.clone())
}

/// Classify a cancel SolvaPayError message into a helper error (with details).
///
/// # Arguments
///
/// * `message` - SolvaPayError.message.
///
/// # Returns
///
/// Frozen status/label with `details` = raw message.
pub fn classify_cancel_error(message: &str) -> HelperErrorResult {
    if message.contains("not found") {
        return HelperErrorResult::with_details(PURCHASE_NOT_FOUND, 404, message);
    }
    if message.contains("cannot be cancelled") || message.contains("does not belong to provider") {
        return HelperErrorResult::with_details(CANCEL_CANNOT, 400, message);
    }
    HelperErrorResult::with_details(message, 500, message)
}

/// Classify a reactivate SolvaPayError message into a helper error (with details).
///
/// # Arguments
///
/// * `message` - SolvaPayError.message.
///
/// # Returns
///
/// Frozen status/label with `details` = raw message.
pub fn classify_reactivate_error(message: &str) -> HelperErrorResult {
    if message.contains("not found") {
        return HelperErrorResult::with_details(PURCHASE_NOT_FOUND, 404, message);
    }
    if message.contains("cannot be reactivated")
        || message.contains("not pending cancellation")
        || message.contains("already been fully cancelled")
        || message.contains("already ended")
    {
        return HelperErrorResult::with_details(REACTIVATE_CANNOT, 400, message);
    }
    HelperErrorResult::with_details(message, 500, message)
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
    fn purchase_ref_present() {
        assert!(validate_purchase_ref(Some("pur_1")).is_none());
    }

    #[test]
    fn purchase_ref_missing() {
        let err = validate_purchase_ref(None).unwrap();
        assert_eq!(err.error, PURCHASE_REF_REQUIRED);
        assert_eq!(err.status, 400);
        assert!(err.details.is_none());
    }

    #[test]
    fn purchase_ref_empty() {
        let err = validate_purchase_ref(Some("")).unwrap();
        assert_eq!(err.error, PURCHASE_REF_REQUIRED);
        assert_eq!(err.status, 400);
    }

    #[test]
    fn cancel_normalize_flat_status() {
        let purchase = json!({ "reference": "pur_1", "status": "cancelled" });
        let ok = normalize_cancel_response(&purchase).unwrap();
        assert_eq!(ok, purchase);
    }

    #[test]
    fn cancel_normalize_cancelled_at() {
        let purchase = json!({
            "reference": "pur_1",
            "status": "active",
            "cancelledAt": "2026-07-01T00:00:00Z"
        });
        assert!(normalize_cancel_response(&purchase).is_ok());
    }

    #[test]
    fn cancel_normalize_nested() {
        let nested = json!({
            "purchase": { "reference": "pur_1", "status": "cancelled" }
        });
        let ok = normalize_cancel_response(&nested).unwrap();
        assert_eq!(ok["reference"], "pur_1");
    }

    #[test]
    fn cancel_normalize_invalid_null() {
        let err = normalize_cancel_response(&Value::Null).unwrap_err();
        assert_eq!(err.error, CANCEL_INVALID);
        assert_eq!(err.status, 500);
    }

    #[test]
    fn cancel_normalize_missing_reference() {
        let err = normalize_cancel_response(&json!({ "status": "cancelled" })).unwrap_err();
        assert_eq!(err.error, CANCEL_MISSING_FIELDS);
        assert_eq!(err.status, 500);
    }

    #[test]
    fn cancel_normalize_not_cancelled() {
        let err = normalize_cancel_response(&json!({
            "reference": "pur_1",
            "status": "active"
        }))
        .unwrap_err();
        assert_eq!(
            err.error,
            "Purchase cancellation failed: backend returned status 'active' without cancelledAt timestamp"
        );
        assert_eq!(err.status, 500);
    }

    #[test]
    fn reactivate_normalize_ok() {
        let purchase = json!({ "reference": "pur_1", "status": "active" });
        assert_eq!(normalize_reactivate_response(&purchase).unwrap(), purchase);
    }

    #[test]
    fn reactivate_normalize_nested() {
        let nested = json!({
            "purchase": { "reference": "pur_1", "status": "active" }
        });
        let ok = normalize_reactivate_response(&nested).unwrap();
        assert_eq!(ok["reference"], "pur_1");
    }

    #[test]
    fn reactivate_normalize_invalid() {
        let err = normalize_reactivate_response(&Value::Null).unwrap_err();
        assert_eq!(err.error, REACTIVATE_INVALID);
        assert_eq!(err.status, 500);
    }

    #[test]
    fn reactivate_normalize_missing_reference() {
        let err = normalize_reactivate_response(&json!({ "status": "active" })).unwrap_err();
        assert_eq!(err.error, REACTIVATE_MISSING_FIELDS);
        assert_eq!(err.status, 500);
    }

    #[test]
    fn reactivate_normalize_cancelled_at_still_set() {
        let err = normalize_reactivate_response(&json!({
            "reference": "pur_1",
            "cancelledAt": "2026-07-01T00:00:00Z"
        }))
        .unwrap_err();
        assert_eq!(err.error, REACTIVATE_CANCELLED_AT_STILL_SET);
        assert_eq!(err.status, 500);
    }

    #[test]
    fn cancel_error_not_found() {
        let err = classify_cancel_error("Purchase pur_1 not found");
        assert_eq!(err.error, PURCHASE_NOT_FOUND);
        assert_eq!(err.status, 404);
        assert_eq!(err.details.as_deref(), Some("Purchase pur_1 not found"));
    }

    #[test]
    fn cancel_error_cannot_be_cancelled() {
        let err = classify_cancel_error("Purchase cannot be cancelled");
        assert_eq!(err.error, CANCEL_CANNOT);
        assert_eq!(err.status, 400);
    }

    #[test]
    fn cancel_error_does_not_belong() {
        let err = classify_cancel_error("Purchase does not belong to provider");
        assert_eq!(err.error, CANCEL_CANNOT);
        assert_eq!(err.status, 400);
    }

    #[test]
    fn cancel_error_other() {
        let err = classify_cancel_error("upstream boom");
        assert_eq!(err.error, "upstream boom");
        assert_eq!(err.status, 500);
        assert_eq!(err.details.as_deref(), Some("upstream boom"));
    }

    #[test]
    fn reactivate_error_not_found() {
        let err = classify_reactivate_error("Purchase pur_1 not found");
        assert_eq!(err.error, PURCHASE_NOT_FOUND);
        assert_eq!(err.status, 404);
    }

    #[test]
    fn reactivate_error_cannot_be_reactivated() {
        let err = classify_reactivate_error("Purchase cannot be reactivated");
        assert_eq!(err.error, REACTIVATE_CANNOT);
        assert_eq!(err.status, 400);
    }

    #[test]
    fn reactivate_error_not_pending() {
        let err = classify_reactivate_error("not pending cancellation");
        assert_eq!(err.error, REACTIVATE_CANNOT);
        assert_eq!(err.status, 400);
    }

    #[test]
    fn reactivate_error_already_fully_cancelled() {
        let err = classify_reactivate_error("already been fully cancelled");
        assert_eq!(err.error, REACTIVATE_CANNOT);
        assert_eq!(err.status, 400);
    }

    #[test]
    fn reactivate_error_already_ended() {
        let err = classify_reactivate_error("already ended");
        assert_eq!(err.error, REACTIVATE_CANNOT);
        assert_eq!(err.status, 400);
    }

    #[test]
    fn reactivate_error_other() {
        let err = classify_reactivate_error("upstream boom");
        assert_eq!(err.error, "upstream boom");
        assert_eq!(err.status, 500);
    }
}
