//! Pure SolvaPay SDK logic.
//!
//! Dependency discipline (§4.3): `serde`, `serde_json`, optional `hmac`/`sha2`/
//! `subtle` (via `hmac-crypto`), plus `solvapay-dto` for generated error-template
//! constants. No HTTP, no tokio, no wasm-bindgen.
//!
//! Capability features (§7.1): `server` = `client-full` + `webhook-verify`;
//! `browser` = `client-public` only (no webhook / no JWT HMAC).

pub mod activation;
#[cfg(feature = "client-full")]
pub mod auth_resolution;
pub mod balance_poll;
pub mod business_details;
pub mod checkout;
pub mod credit_display;
pub mod customer_sync;
pub mod error;
pub mod helper_error;
#[cfg(feature = "hmac-crypto")]
mod hmac_util;
pub mod limits;
pub mod mcp;
pub mod payment;
pub mod paywall_decision;
pub mod paywall_gate;
pub mod paywall_payload;
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
#[cfg(feature = "webhook-verify")]
pub mod webhook;

pub use activation::validate_activate_plan_params;
#[cfg(feature = "client-full")]
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
pub use mcp::{
    assert_response_result, build_prompt_descriptor_metadata, build_prompt_user_message,
    build_tool_descriptor_metadata, derive_icons, make_response_result, mcp_tool_names_json,
    mcp_view_maps, paywall_tool_result, validate_public_base_url,
    BuildPromptDescriptorMetadataOptions, BuildToolDescriptorMetadataOptions, McpContentBlock,
    McpPaywallToolResult, McpViewMaps, MerchantBranding, PromptDescriptorMetadata,
    PromptUserMessage, ResponseEnvelope, ToolAnnotations, ToolDescriptorMetadata, ToolIcon,
    MCP_TOOL_NAMES, PUBLIC_BASE_URL_ERROR, TOOL_FOR_VIEW, VIEW_FOR_TOOL,
};
pub use payment::{
    attach_business_details_validation_error, project_payment_intent_result,
    project_topup_process_outcome, validate_attach_business_details_params,
    validate_create_payment_intent_params, validate_process_payment_intent_params,
    validate_topup_payment_intent_params, PaymentIntentProjection, PaymentIntentSource,
    TopupProcessOutcome,
};
pub use paywall_decision::{
    decide_paywall_outcome, evaluate_cached_limits, evaluate_fresh_limits,
    resolve_fallback_gate_limits, resolve_product_ref, CachedLimitsEvaluation,
    FreshLimitsEvaluation, PaywallOutcome,
};
pub use paywall_gate::{build_paywall_gate, PaywallGate, PaywallGateKind, PaywallGateLimits};
pub use paywall_payload::{paywall_client_payload, PaywallClientPayload};
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
#[cfg(feature = "webhook-verify")]
pub use webhook::{verify_webhook, WebhookError, WebhookErrorCode};

#[cfg(test)]
mod feature_gates {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, missing_docs)]

    /// Documents the §7.1 feature contract for Step 38 compile checks.
    ///
    /// Run manually:
    /// - `cargo check -p solvapay-core` (default/server)
    /// - `cargo check -p solvapay-core --no-default-features --features browser`
    #[test]
    fn feature_contract_markers_exist() {
        assert!(
            cfg!(feature = "server")
                || cfg!(feature = "browser")
                || cfg!(feature = "client-public")
                || cfg!(feature = "client-full")
                || cfg!(feature = "webhook-verify")
                || !cfg!(feature = "hmac-crypto")
        );
    }
}
