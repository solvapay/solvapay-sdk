//! Pure SolvaPay SDK logic.
//!
//! Dependency discipline (§4.3): `serde`, `serde_json`, `hmac`/`sha2`, `subtle`,
//! plus `solvapay-dto` for generated error-template constants. No HTTP, no tokio,
//! no wasm-bindgen.

pub mod activation;
pub mod auth_resolution;
pub mod balance_poll;
pub mod business_details;
pub mod checkout;
pub mod credit_display;
pub mod customer_sync;
pub mod error;
pub mod helper_error;
mod hmac_util;
pub mod limits;
pub mod payment;
pub mod paywall_gate;
pub mod paywall_state;
pub mod plans;
pub mod product;
pub mod purchase;
pub mod renewal;
pub mod retry;
pub mod route_error;
pub mod seller_identity;
mod serde_util;
pub mod usage;
pub mod webhook;

pub use activation::validate_activate_plan_params;
pub use auth_resolution::{resolve_authenticated_user, AuthResolutionInput, AuthenticatedUser};
pub use balance_poll::{
    evaluate_balance_observation, BalancePollPolicy, BALANCE_RECONCILE_DELAYS_MS,
    TOPUP_BALANCE_POLL_DELAYS_MS,
};
pub use business_details::{
    derive_tax_id_type, get_business_country_options, get_tax_id_example, get_tax_id_field_label,
    get_tax_id_helper_text, is_supported_business_country, resolve_tax_behavior,
    validate_business_details, BusinessCountryOption, BusinessDetails, BusinessDetailsInput,
    BusinessDetailsValidationError, BusinessDetailsValidationIssue, TaxIdType,
    ValidateBusinessDetailsResult, TAX_BEHAVIORS, TAX_EXCLUSIVE_CURRENCIES, TAX_ID_TYPES,
};
pub use checkout::{resolve_return_url, validate_checkout_session_params};
pub use credit_display::{
    credits_to_display_minor_units, is_zero_decimal_currency, minor_units_per_major,
    CreditsToDisplayInput,
};
pub use customer_sync::{
    build_create_customer_params, classify_create_error, classify_customer_ref,
    classify_lookup_error, coerce_customer_options, extract_backend_customer_ref,
    is_email_conflict, CoercedCustomerOptions, CreateCustomerParams, CreateErrorKind,
    CustomerRefKind, LookupErrorKind,
};
pub use error::{render_template, SdkError};
pub use helper_error::HelperErrorResult;
pub use limits::{resolve_check_limits_params, CheckLimitsParams};
pub use payment::{
    attach_business_details_validation_error, project_payment_intent_result,
    project_topup_process_outcome, validate_attach_business_details_params,
    validate_create_payment_intent_params, validate_process_payment_intent_params,
    validate_topup_payment_intent_params, PaymentIntentProjection, PaymentIntentSource,
    TopupProcessOutcome,
};
pub use paywall_gate::{build_paywall_gate, PaywallGate, PaywallGateKind, PaywallGateLimits};
pub use paywall_state::{
    build_gate_message, build_nudge_message, classify_paywall_state, GateContent, PaywallBalance,
    PaywallLimits, PaywallPlanSummary, PaywallState,
};
pub use plans::validate_list_plans_params;
pub use product::validate_get_product_params;
pub use purchase::{
    is_cached_customer_ref_valid, resolve_purchase_customer_ref, select_active_purchases,
};
pub use renewal::{
    classify_cancel_error, classify_reactivate_error, normalize_cancel_response,
    normalize_reactivate_response, validate_purchase_ref,
};
pub use retry::{Backoff, RetryPolicy, DEFAULT_INITIAL_DELAY_MS, DEFAULT_MAX_RETRIES};
pub use route_error::{is_error_result, map_route_error, RouteErrorInput, RouteErrorKind};
pub use seller_identity::{
    get_seller_tax_identifier_display_label, resolve_seller_identity_display,
    seller_tax_identifier_display_label_by_type, SellerIdentityDisplay, SellerIdentityInput,
    SellerIdentityRow, SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE,
};
pub use usage::{project_usage_snapshot, UsageSnapshot};
pub use webhook::{verify_webhook, WebhookError, WebhookErrorCode};
