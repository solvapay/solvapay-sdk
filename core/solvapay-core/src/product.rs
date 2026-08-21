//! Pure product helper decision cores (Step 31).

use crate::helper_error::HelperErrorResult;

/// Frozen 400 message when productRef is missing or empty.
const PRODUCT_REF_MISSING: &str = "Missing required parameter: productRef";

/// Validate get-product query productRef (JS truthiness: empty string fails).
///
/// # Arguments
///
/// * `product_ref` - Product reference; empty/`None` fails.
///
/// # Returns
///
/// [`None`] when productRef is present and non-empty; otherwise the frozen 400
/// without `details`.
pub fn validate_get_product_params(product_ref: Option<&str>) -> Option<HelperErrorResult> {
    match product_ref {
        Some(r) if !r.is_empty() => None,
        _ => Some(HelperErrorResult::without_details(PRODUCT_REF_MISSING, 400)),
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
    fn product_ref_missing() {
        let err = validate_get_product_params(None).unwrap();
        assert_eq!(err.error, PRODUCT_REF_MISSING);
        assert_eq!(err.status, 400);
        assert!(err.details.is_none());
    }

    #[test]
    fn product_ref_empty() {
        let err = validate_get_product_params(Some("")).unwrap();
        assert_eq!(err.error, PRODUCT_REF_MISSING);
        assert_eq!(err.status, 400);
    }

    #[test]
    fn product_ref_present() {
        assert!(validate_get_product_params(Some("prd_1")).is_none());
    }
}
