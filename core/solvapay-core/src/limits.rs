//! Pure limits helper decision cores (Step 30).

use serde::{Deserialize, Serialize};

use crate::helper_error::HelperErrorResult;

/// Frozen 400 message when productRef is missing or empty.
const PRODUCT_REF_MISSING: &str = "Missing required parameter: productRef";

/// Default meter name when the query value is falsy.
const DEFAULT_METER_NAME: &str = "requests";

/// Resolved check-limits query params.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckLimitsParams {
    /// Required product reference.
    pub product_ref: String,
    /// Meter name (`'requests'` when the input was falsy).
    pub meter_name: String,
}

/// Validate check-limits query params (JS truthiness: empty string fails).
///
/// # Arguments
///
/// * `product_ref` - Product reference; empty/`None` fails.
/// * `meter_name` - Optional meter; falsy → `"requests"`.
///
/// # Returns
///
/// [`Ok`] with resolved params, or [`Err`] with the frozen 400.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "none",
    section = "limits",
    emit_order = 26
)]
pub fn resolve_check_limits_params(
    product_ref: Option<&str>,
    meter_name: Option<&str>,
    usage_type: Option<&str>,
) -> Result<CheckLimitsParams, HelperErrorResult> {
    let Some(product_ref) = product_ref.filter(|s| !s.is_empty()) else {
        return Err(HelperErrorResult::without_details(PRODUCT_REF_MISSING, 400));
    };
    let meter = js_or_str(meter_name)
        .or_else(|| js_or_str(usage_type))
        .unwrap_or_else(|| DEFAULT_METER_NAME.to_owned());
    Ok(CheckLimitsParams {
        product_ref: product_ref.to_owned(),
        meter_name: meter,
    })
}

/// True when `remaining` is the backend's unlimited sentinel (`-1`).
///
/// An unexpected negative (for example `-2`) is not treated as unlimited.
#[crate::solvapay_export(
    artifact = "payloadBuilders",
    catalog = "coreHelper",
    section = "credit-display",
    emit_order = 13
)]
pub fn is_unlimited_remaining(remaining: f64) -> bool {
    remaining == -1.0
}

/// JS `||` string: `None` / empty / whitespace-only → absent.
fn js_or_str(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned)
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
        let err = resolve_check_limits_params(None, Some("requests"), None).unwrap_err();
        assert_eq!(err.error, PRODUCT_REF_MISSING);
        assert_eq!(err.status, 400);
    }

    #[test]
    fn product_ref_empty() {
        let err = resolve_check_limits_params(Some(""), Some("requests"), None).unwrap_err();
        assert_eq!(err.error, PRODUCT_REF_MISSING);
    }

    #[test]
    fn both_present() {
        let params = resolve_check_limits_params(Some("prd_1"), Some("api_calls"), None).unwrap();
        assert_eq!(params.product_ref, "prd_1");
        assert_eq!(params.meter_name, "api_calls");
    }

    #[test]
    fn meter_name_defaults_when_absent() {
        let params = resolve_check_limits_params(Some("prd_1"), None, None).unwrap();
        assert_eq!(params.meter_name, DEFAULT_METER_NAME);
    }

    #[test]
    fn meter_name_defaults_when_empty() {
        let params = resolve_check_limits_params(Some("prd_1"), Some(""), None).unwrap();
        assert_eq!(params.meter_name, DEFAULT_METER_NAME);
    }

    #[test]
    fn usage_type_alias_when_meter_absent() {
        let params = resolve_check_limits_params(Some("prd_1"), None, Some("tokens")).unwrap();
        assert_eq!(params.meter_name, "tokens");
    }

    #[test]
    fn meter_name_wins_over_usage_type() {
        let params =
            resolve_check_limits_params(Some("prd_1"), Some("api_calls"), Some("tokens")).unwrap();
        assert_eq!(params.meter_name, "api_calls");
    }

    #[test]
    fn unlimited_sentinel_is_negative_one() {
        assert!(is_unlimited_remaining(-1.0));
        assert!(!is_unlimited_remaining(-2.0));
        assert!(!is_unlimited_remaining(0.0));
        assert!(!is_unlimited_remaining(5.0));
    }
}
