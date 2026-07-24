//! Pure payment helper decision/normalization cores (Step 27).

use serde::{Deserialize, Serialize};

use crate::helper_error::HelperErrorResult;

/// Frozen 400 message when planRef/productRef are missing or empty.
const CREATE_PI_MISSING: &str = "Missing required parameters: planRef and productRef are required";
/// Frozen 400 message when top-up amount is missing, zero, negative, or NaN.
const TOPUP_AMOUNT_INVALID: &str = "Missing or invalid amount: must be a positive number";
/// Frozen 400 message when top-up currency is missing or empty.
const TOPUP_CURRENCY_MISSING: &str = "Missing required parameter: currency";
/// Frozen 400 message when process-PI paymentIntentId/productRef are missing.
const PROCESS_PI_MISSING: &str = "paymentIntentId and productRef are required";
/// Frozen 400 message when paymentIntentId is missing (attach / process-topup).
const PAYMENT_INTENT_ID_REQUIRED: &str = "paymentIntentId is required";
/// Frozen fallback when Zod validation yields no issue message.
const INVALID_BUSINESS_DETAILS: &str = "Invalid business details";

/// Projected create-PI / create-topup helper return shape.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentIntentProjection {
    /// Processor payment id.
    pub processor_payment_id: String,
    /// Client secret for confirmation.
    pub client_secret: String,
    /// Publishable key.
    pub publishable_key: String,
    /// Connected account id (skip-absent when [`None`]).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_id: Option<String>,
    /// Synced customer reference.
    pub customer_ref: String,
}

/// Source fields from a create-PI / create-topup client response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PaymentIntentSource {
    /// Processor payment id.
    pub processor_payment_id: String,
    /// Client secret.
    pub client_secret: String,
    /// Publishable key.
    pub publishable_key: String,
    /// Optional connected account id.
    pub account_id: Option<String>,
}

/// Topup process outcome (poll / creditsAdded stay host-side).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopupProcessOutcome {
    /// Narrowed status.
    pub status: String,
    /// Timeout message (skip-absent when [`None`]).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// JS-truthiness for string refs: [`None`] and `""` fail.
fn is_nonempty(value: Option<&str>) -> bool {
    value.is_some_and(|s| !s.is_empty())
}

/// Validate create-payment-intent body refs (JS truthiness: empty string fails).
///
/// # Arguments
///
/// * `plan_ref` - Plan reference; empty/`None` fails.
/// * `product_ref` - Product reference; empty/`None` fails.
///
/// # Returns
///
/// [`None`] when both refs are present and non-empty; otherwise the frozen 400.
pub fn validate_create_payment_intent_params(
    plan_ref: Option<&str>,
    product_ref: Option<&str>,
) -> Option<HelperErrorResult> {
    if is_nonempty(plan_ref) && is_nonempty(product_ref) {
        None
    } else {
        Some(HelperErrorResult::without_details(CREATE_PI_MISSING, 400))
    }
}

/// JS-truthiness + `<= 0` check for top-up amount (`!amount || amount <= 0`).
fn is_invalid_amount(amount: Option<f64>) -> bool {
    match amount {
        None => true,
        Some(n) if n.is_nan() || n == 0.0 || n < 0.0 => true,
        // JS `!amount` is also true for NaN; finite positives pass.
        Some(_) => false,
    }
}

/// Validate top-up payment-intent params (ordered: amount → currency presence → case).
///
/// # Arguments
///
/// * `amount` - Amount in minor units; must be a positive finite number.
/// * `currency` - Uppercase ISO 4217 code.
///
/// # Returns
///
/// [`None`] when valid; otherwise the first failing branch's frozen 400.
pub fn validate_topup_payment_intent_params(
    amount: Option<f64>,
    currency: Option<&str>,
) -> Option<HelperErrorResult> {
    if is_invalid_amount(amount) {
        return Some(HelperErrorResult::without_details(
            TOPUP_AMOUNT_INVALID,
            400,
        ));
    }
    let Some(currency) = currency.filter(|s| !s.is_empty()) else {
        return Some(HelperErrorResult::without_details(
            TOPUP_CURRENCY_MISSING,
            400,
        ));
    };
    if currency != currency.to_ascii_uppercase() {
        return Some(HelperErrorResult::without_details(
            format!(
                "Invalid currency \"{currency}\": must be an uppercase ISO 4217 code (e.g. \"USD\", \"EUR\")"
            ),
            400,
        ));
    }
    None
}

/// Validate process-payment-intent body refs (JS truthiness).
///
/// # Arguments
///
/// * `payment_intent_id` - Processor payment id.
/// * `product_ref` - Product reference.
///
/// # Returns
///
/// [`None`] when both are present and non-empty.
pub fn validate_process_payment_intent_params(
    payment_intent_id: Option<&str>,
    product_ref: Option<&str>,
) -> Option<HelperErrorResult> {
    if is_nonempty(payment_intent_id) && is_nonempty(product_ref) {
        None
    } else {
        Some(HelperErrorResult::without_details(PROCESS_PI_MISSING, 400))
    }
}

/// Validate that `paymentIntentId` is present (attach-business-details / process-topup).
///
/// # Arguments
///
/// * `payment_intent_id` - Processor payment id.
///
/// # Returns
///
/// [`None`] when the id is present and non-empty.
pub fn validate_attach_business_details_params(
    payment_intent_id: Option<&str>,
) -> Option<HelperErrorResult> {
    if is_nonempty(payment_intent_id) {
        None
    } else {
        Some(HelperErrorResult::without_details(
            PAYMENT_INTENT_ID_REQUIRED,
            400,
        ))
    }
}

/// Freeze the Zod-issue fallback used by attach-business-details.
///
/// # Arguments
///
/// * `first_issue_message` - First Zod issue message, if any.
///
/// # Returns
///
/// A 400 [`HelperErrorResult`] with the message or `"Invalid business details"`.
pub fn attach_business_details_validation_error(
    first_issue_message: Option<&str>,
) -> HelperErrorResult {
    HelperErrorResult::without_details(first_issue_message.unwrap_or(INVALID_BUSINESS_DETAILS), 400)
}

/// Project a create-PI / create-topup response down to the helper return shape.
///
/// # Arguments
///
/// * `pi` - Source payment-intent fields.
/// * `customer_ref` - Synced customer reference.
///
/// # Returns
///
/// [`PaymentIntentProjection`] with skip-absent `accountId`.
pub fn project_payment_intent_result(
    pi: &PaymentIntentSource,
    customer_ref: &str,
) -> PaymentIntentProjection {
    PaymentIntentProjection {
        processor_payment_id: pi.processor_payment_id.clone(),
        client_secret: pi.client_secret.clone(),
        publishable_key: pi.publishable_key.clone(),
        account_id: pi.account_id.clone(),
        customer_ref: customer_ref.to_owned(),
    }
}

/// Project a process-payment result down to the topup outcome shape.
///
/// Unknown / missing status fails closed to `{ status: "failed" }`.
/// Succeeded returns the bare marker — balance polling stays host-side.
///
/// # Arguments
///
/// * `status` - Backend process status.
/// * `message` - Optional timeout message.
///
/// # Returns
///
/// Narrowed [`TopupProcessOutcome`].
pub fn project_topup_process_outcome(
    status: Option<&str>,
    message: Option<&str>,
) -> TopupProcessOutcome {
    match status {
        Some("timeout") => TopupProcessOutcome {
            status: "timeout".to_owned(),
            message: message.map(str::to_owned),
        },
        Some("failed") => TopupProcessOutcome {
            status: "failed".to_owned(),
            message: None,
        },
        Some("cancelled") => TopupProcessOutcome {
            status: "cancelled".to_owned(),
            message: None,
        },
        Some("succeeded") => TopupProcessOutcome {
            status: "succeeded".to_owned(),
            message: None,
        },
        _ => TopupProcessOutcome {
            status: "failed".to_owned(),
            message: None,
        },
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
    fn create_pi_both_present_ok() {
        assert!(validate_create_payment_intent_params(Some("pln"), Some("prd")).is_none());
    }

    #[test]
    fn create_pi_empty_fails() {
        let err = validate_create_payment_intent_params(Some(""), Some("prd")).unwrap();
        assert_eq!(err.error, CREATE_PI_MISSING);
        assert_eq!(err.status, 400);
    }

    #[test]
    fn topup_valid_ok() {
        assert!(validate_topup_payment_intent_params(Some(1000.0), Some("USD")).is_none());
    }

    #[test]
    fn topup_amount_zero_fails() {
        let err = validate_topup_payment_intent_params(Some(0.0), Some("USD")).unwrap();
        assert_eq!(err.error, TOPUP_AMOUNT_INVALID);
    }

    #[test]
    fn topup_currency_lowercase_message_byte_exact() {
        let err = validate_topup_payment_intent_params(Some(1000.0), Some("usd")).unwrap();
        assert_eq!(
            err.error,
            "Invalid currency \"usd\": must be an uppercase ISO 4217 code (e.g. \"USD\", \"EUR\")"
        );
    }

    #[test]
    fn process_both_present_ok() {
        assert!(validate_process_payment_intent_params(Some("pi"), Some("prd")).is_none());
    }

    #[test]
    fn attach_pi_required() {
        let err = validate_attach_business_details_params(Some("")).unwrap();
        assert_eq!(err.error, PAYMENT_INTENT_ID_REQUIRED);
    }

    #[test]
    fn attach_validation_uses_message() {
        let err = attach_business_details_validation_error(Some("Business name is required"));
        assert_eq!(err.error, "Business name is required");
    }

    #[test]
    fn project_keeps_account_id() {
        let projected = project_payment_intent_result(
            &PaymentIntentSource {
                processor_payment_id: "pi".into(),
                client_secret: "cs".into(),
                publishable_key: "pk".into(),
                account_id: Some("acct".into()),
            },
            "cus",
        );
        assert_eq!(projected.account_id.as_deref(), Some("acct"));
    }

    #[test]
    fn topup_outcome_timeout_with_message() {
        let outcome = project_topup_process_outcome(Some("timeout"), Some("delayed"));
        assert_eq!(outcome.status, "timeout");
        assert_eq!(outcome.message.as_deref(), Some("delayed"));
    }

    #[test]
    fn topup_outcome_succeeded() {
        let outcome = project_topup_process_outcome(Some("succeeded"), None);
        assert_eq!(outcome.status, "succeeded");
        assert!(outcome.message.is_none());
    }
}
