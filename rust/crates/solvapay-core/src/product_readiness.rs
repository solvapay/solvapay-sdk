//! Product-ref shape checks and readiness evaluation.
//!
//! No network — shared by `verifyProductConfiguration` and `solvapay doctor`
//! so the "ready" rule has one definition.

use serde::{Deserialize, Serialize};

use crate::error::SdkError;

/// Scaffolder placeholder that must be replaced before a product can sell.
pub const SOLVAPAY_PRODUCT_REF_PLACEHOLDER: &str = "__SOLVAPAY_PRODUCT_REF__";

/// Product refs issued by the platform are `prd_`-prefixed.
const PRODUCT_REF_SHAPE_PREFIX: &str = "prd_";

/// Input to [`evaluate_product_readiness`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductReadinessInput {
    /// Product status (`active`, `draft`, …).
    pub status: String,
    /// Plans; omitted treated as empty.
    #[serde(default)]
    pub plans: Option<Vec<ProductReadinessPlan>>,
}

/// Plan activity flag used by readiness evaluation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductReadinessPlan {
    /// Whether the plan can currently be purchased.
    pub is_active: bool,
}

/// Result of [`evaluate_product_readiness`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductReadinessResult {
    /// True when status is active and at least one plan is active.
    pub ready: bool,
    /// Human-readable reasons `ready` is false. Empty when ready.
    pub issues: Vec<String>,
    /// Count of active plans.
    pub active_plans: u32,
    /// Total plan count (including inactive).
    pub total_plans: u32,
}

/// Whether a resolved product can be sold end-to-end.
pub fn evaluate_product_readiness(product: &ProductReadinessInput) -> ProductReadinessResult {
    let plans = product.plans.as_deref().unwrap_or(&[]);
    let active_plans = plans.iter().filter(|plan| plan.is_active).count() as u32;
    let mut issues: Vec<String> = Vec::new();

    if product.status != "active" {
        issues.push(format!("product status is \"{}\"", product.status));
    }
    if active_plans == 0 {
        issues.push(if plans.is_empty() {
            "no plans defined — customers have nothing to purchase".to_owned()
        } else {
            format!("none of its {} plan(s) are active", plans.len())
        });
    }

    ProductReadinessResult {
        ready: issues.is_empty(),
        issues,
        active_plans,
        total_plans: plans.len() as u32,
    }
}

/// Synchronous shape check for a product ref.
///
/// # Errors
///
/// Returns [`SdkError::Api`] when the ref is empty, the scaffolder
/// placeholder, or not `prd_`-shaped. Messages name `context`.
pub fn assert_valid_product_ref(product_ref: &str, context: &str) -> Result<(), SdkError> {
    let trimmed = product_ref.trim();
    if trimmed.is_empty() {
        return Err(SdkError::Api {
            message: format!("{context}: productRef is required (expected a prd_* reference)."),
            status: None,
            code: Some("invalid_product_ref".to_owned()),
        });
    }
    if trimmed == SOLVAPAY_PRODUCT_REF_PLACEHOLDER {
        return Err(SdkError::Api {
            message: format!(
                "{context}: productRef is still the scaffolder placeholder \
\"{SOLVAPAY_PRODUCT_REF_PLACEHOLDER}\". Run `npx solvapay init` \
(or `npx solvapay doctor`) to set a real product reference."
            ),
            status: None,
            code: Some("placeholder_product_ref".to_owned()),
        });
    }
    if !trimmed.starts_with(PRODUCT_REF_SHAPE_PREFIX) {
        return Err(SdkError::Api {
            message: format!(
                "{context}: productRef must look like \"prd_…\" (got \"{trimmed}\"). \
Copy the reference from SolvaPay Console → Products."
            ),
            status: None,
            code: Some("invalid_product_ref".to_owned()),
        });
    }
    Ok(())
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
    fn active_with_active_plan() {
        let result = evaluate_product_readiness(&ProductReadinessInput {
            status: "active".into(),
            plans: Some(vec![
                ProductReadinessPlan { is_active: true },
                ProductReadinessPlan { is_active: false },
            ]),
        });
        assert!(result.ready);
        assert!(result.issues.is_empty());
        assert_eq!(result.active_plans, 1);
        assert_eq!(result.total_plans, 2);
    }

    #[test]
    fn inactive_status() {
        let result = evaluate_product_readiness(&ProductReadinessInput {
            status: "draft".into(),
            plans: Some(vec![ProductReadinessPlan { is_active: true }]),
        });
        assert!(!result.ready);
        assert!(result.issues.iter().any(|i| i == "product status is \"draft\""));
        assert_eq!(result.active_plans, 1);
    }

    #[test]
    fn no_plans() {
        let result = evaluate_product_readiness(&ProductReadinessInput {
            status: "active".into(),
            plans: None,
        });
        assert!(!result.ready);
        assert!(result
            .issues
            .iter()
            .any(|i| i == "no plans defined — customers have nothing to purchase"));
        assert_eq!(result.total_plans, 0);
        assert_eq!(result.active_plans, 0);
    }

    #[test]
    fn all_plans_inactive() {
        let result = evaluate_product_readiness(&ProductReadinessInput {
            status: "active".into(),
            plans: Some(vec![
                ProductReadinessPlan { is_active: false },
                ProductReadinessPlan { is_active: false },
            ]),
        });
        assert!(!result.ready);
        assert!(result
            .issues
            .iter()
            .any(|i| i == "none of its 2 plan(s) are active"));
        assert_eq!(result.active_plans, 0);
        assert_eq!(result.total_plans, 2);
    }

    #[test]
    fn assert_valid_prd_ok() {
        assert!(assert_valid_product_ref("prd_ABC123", "test").is_ok());
    }

    #[test]
    fn assert_empty_rejected() {
        let err = assert_valid_product_ref("", "test").unwrap_err();
        let SdkError::Api { message, .. } = err else {
            panic!("expected Api");
        };
        assert!(message.contains("productRef is required"));
    }

    #[test]
    fn assert_placeholder_rejected() {
        let err = assert_valid_product_ref(SOLVAPAY_PRODUCT_REF_PLACEHOLDER, "test").unwrap_err();
        let SdkError::Api { message, .. } = err else {
            panic!("expected Api");
        };
        assert!(message.contains("scaffolder placeholder"));
    }

    #[test]
    fn assert_bad_shape_rejected() {
        let err = assert_valid_product_ref("prod_ABC", "buildSolvaPayDescriptors").unwrap_err();
        let SdkError::Api { message, .. } = err else {
            panic!("expected Api");
        };
        assert!(message.contains("buildSolvaPayDescriptors: productRef must look like"));
    }
}
