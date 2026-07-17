//! Pure SolvaPay SDK logic.
//!
//! Dependency discipline (§4.3): `serde`, `serde_json`, `hmac`/`sha2`, `subtle`,
//! plus `solvapay-dto` for generated error-template constants. No HTTP, no tokio,
//! no wasm-bindgen.

pub mod business_details;
pub mod credit_display;
pub mod error;
pub mod paywall_gate;
pub mod paywall_state;
pub mod retry;
pub mod seller_identity;
pub mod webhook;

pub use business_details::{
    derive_tax_id_type, get_business_country_options, get_tax_id_example, get_tax_id_field_label,
    get_tax_id_helper_text, is_supported_business_country, resolve_tax_behavior,
    validate_business_details, BusinessCountryOption, BusinessDetails, BusinessDetailsInput,
    BusinessDetailsValidationError, BusinessDetailsValidationIssue, TaxIdType,
    ValidateBusinessDetailsResult, TAX_BEHAVIORS, TAX_EXCLUSIVE_CURRENCIES, TAX_ID_TYPES,
};
pub use credit_display::{
    credits_to_display_minor_units, is_zero_decimal_currency, minor_units_per_major,
    CreditsToDisplayInput,
};
pub use error::{render_template, SdkError};
pub use paywall_gate::{build_paywall_gate, PaywallGate, PaywallGateKind, PaywallGateLimits};
pub use paywall_state::{
    build_gate_message, build_nudge_message, classify_paywall_state, GateContent, PaywallBalance,
    PaywallLimits, PaywallPlanSummary, PaywallState,
};
pub use retry::{Backoff, RetryPolicy, DEFAULT_INITIAL_DELAY_MS, DEFAULT_MAX_RETRIES};
pub use seller_identity::{
    get_seller_tax_identifier_display_label, resolve_seller_identity_display,
    seller_tax_identifier_display_label_by_type, SellerIdentityDisplay, SellerIdentityInput,
    SellerIdentityRow, SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE,
};
pub use webhook::{verify_webhook, WebhookError, WebhookErrorCode};
