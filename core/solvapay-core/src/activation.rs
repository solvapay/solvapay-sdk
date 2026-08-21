//! Activate-plan parameter validation (Step 26).

use crate::helper_error::HelperErrorResult;

/// Frozen 400 message when productRef/planRef are missing or empty.
const MISSING_PARAMS: &str = "Missing required parameters: productRef and planRef are required";

/// Validate activate-plan body refs (JS truthiness: empty string fails).
///
/// # Arguments
///
/// * `product_ref` - Product reference; empty/`None` fails.
/// * `plan_ref` - Plan reference; empty/`None` fails.
///
/// # Returns
///
/// [`None`] when both refs are present and non-empty; otherwise the frozen 400
/// [`HelperErrorResult`] (no `details` field).
pub fn validate_activate_plan_params(
    product_ref: Option<&str>,
    plan_ref: Option<&str>,
) -> Option<HelperErrorResult> {
    let product_ok = product_ref.is_some_and(|s| !s.is_empty());
    let plan_ok = plan_ref.is_some_and(|s| !s.is_empty());
    if product_ok && plan_ok {
        None
    } else {
        Some(HelperErrorResult::without_details(MISSING_PARAMS, 400))
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

    #[test]
    fn both_present_ok() {
        assert!(validate_activate_plan_params(Some("prod"), Some("plan")).is_none());
    }

    #[test]
    fn empty_strings_fail_without_details() {
        let err = validate_activate_plan_params(Some(""), Some("plan")).unwrap();
        assert_eq!(err.status, 400);
        assert_eq!(err.error, MISSING_PARAMS);
        assert!(err.details.is_none());
        let json = serde_json::to_value(&err).unwrap();
        assert!(json.get("details").is_none());
    }
}
