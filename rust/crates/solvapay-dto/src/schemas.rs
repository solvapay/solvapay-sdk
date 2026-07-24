// @generated — do not edit. Regenerate with: pnpm gen

//! Generated wire schemas.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ActivatePlanDto {
    /// Generated wire DTO.
    #[serde(rename = "customerRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub customer_ref: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "planRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_ref: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "productRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_ref: Option<String>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ActivatePlanResponseDto {
    /// Generated wire DTO.
    #[serde(rename = "checkoutSessionId")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkout_session_id: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "checkoutUrl")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkout_url: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "creditBalance")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credit_balance: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "creditsPerUnit")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credits_per_unit: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "currency")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "message")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "purchaseRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub purchase_ref: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "status")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<ActivatePlanResponseDtoStatus>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ActivatePlanResponseDtoStatus {
    /// Wire value `activated`.
    #[serde(rename = "activated")]
    Activated,
    /// Wire value `already_active`.
    #[serde(rename = "already_active")]
    AlreadyActive,
    /// Wire value `invalid`.
    #[serde(rename = "invalid")]
    Invalid,
    /// Wire value `payment_required`.
    #[serde(rename = "payment_required")]
    PaymentRequired,
    /// Wire value `topup_required`.
    #[serde(rename = "topup_required")]
    TopupRequired,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AutoRechargeConfigDto {
    /// Whether auto-recharge is enabled
    #[serde(rename = "enabled")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    /// Consecutive failure count
    #[serde(rename = "failureCount")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure_count: Option<f64>,
    /// Funding source type
    #[serde(rename = "fundingSourceType")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub funding_source_type: Option<AutoRechargeConfigDtoFundingSourceType>,
    /// PaymentIntent ID of an in-flight recharge
    #[serde(rename = "inFlightPaymentIntentId")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub in_flight_payment_intent_id: Option<String>,
    /// Timestamp of the last successful charge
    #[serde(rename = "lastChargeAt")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_charge_at: Option<String>,
    /// Timestamp the processing lock was acquired
    #[serde(rename = "lockAcquiredAt")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lock_acquired_at: Option<String>,
    /// Optional monthly spend cap in topup.currency minor units
    #[serde(rename = "maxMonthlySpendMinor")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_monthly_spend_minor: Option<f64>,
    /// Successful auto-recharge spend in the current UTC month
    #[serde(rename = "monthlySpendMinor")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub monthly_spend_minor: Option<f64>,
    /// UTC YYYY-MM period key for monthlySpendMinor
    #[serde(rename = "monthlySpendPeriod")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub monthly_spend_period: Option<String>,
    /// Saved payment method ID backing the recharge
    #[serde(rename = "paymentMethodId")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payment_method_id: Option<String>,
    /// Current config status
    #[serde(rename = "status")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<AutoRechargeConfigDtoStatus>,
    /// Generated wire DTO.
    #[serde(rename = "topup")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub topup: Option<AutoRechargeTopupDto>,
    /// Generated wire DTO.
    #[serde(rename = "trigger")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trigger: Option<AutoRechargeTriggerDto>,
    /// Last update timestamp
    #[serde(rename = "updatedAt")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

/// Funding source type
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AutoRechargeConfigDtoFundingSourceType {
    /// Wire value `saved_card`.
    #[serde(rename = "saved_card")]
    SavedCard,
    /// Wire value `tokenized_card`.
    #[serde(rename = "tokenized_card")]
    TokenizedCard,
}

/// Current config status
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AutoRechargeConfigDtoStatus {
    /// Wire value `active`.
    #[serde(rename = "active")]
    Active,
    /// Wire value `disabled`.
    #[serde(rename = "disabled")]
    Disabled,
    /// Wire value `failed`.
    #[serde(rename = "failed")]
    Failed,
    /// Wire value `pending_setup`.
    #[serde(rename = "pending_setup")]
    PendingSetup,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AutoRechargeDisplayDto {
    /// Display currency code
    #[serde(rename = "currency")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    /// Exchange rate used for display conversion
    #[serde(rename = "exchangeRate")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exchange_rate: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "formatted")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formatted: Option<AutoRechargeDisplayFormattedDto>,
    /// Source of the exchange rate
    #[serde(rename = "rateSource")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rate_source: Option<String>,
    /// Threshold amount in display-currency major units
    #[serde(rename = "thresholdAmountMajor")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub threshold_amount_major: Option<f64>,
    /// Top-up amount in display-currency major units
    #[serde(rename = "topupAmountMajor")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub topup_amount_major: Option<f64>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AutoRechargeDisplayFormattedDto {
    /// Formatted threshold amount
    #[serde(rename = "threshold")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub threshold: Option<String>,
    /// Formatted top-up amount
    #[serde(rename = "topup")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub topup: Option<String>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AutoRechargeGetResponse {
    /// Current auto-recharge config, or null when not configured
    #[serde(rename = "config")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config: Option<AutoRechargeConfigDto>,
    /// Generated wire DTO.
    #[serde(rename = "display")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display: Option<AutoRechargeDisplayDto>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AutoRechargeTopupDto {
    /// Top-up amount in currency minor units
    #[serde(rename = "amountMinor")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub amount_minor: Option<f64>,
    /// ISO 4217 currency code
    #[serde(rename = "currency")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    /// Top-up mode
    #[serde(rename = "mode")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<AutoRechargeTopupDtoMode>,
}

/// Top-up mode
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AutoRechargeTopupDtoMode {
    /// Wire value `fixed`.
    #[serde(rename = "fixed")]
    Fixed,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AutoRechargeTriggerDto {
    /// Display-currency minor units for the balance threshold
    #[serde(rename = "thresholdAmountMinor")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub threshold_amount_minor: Option<f64>,
    /// Trigger kind
    #[serde(rename = "type")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub type_: Option<AutoRechargeTriggerDtoType_>,
}

/// Trigger kind
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AutoRechargeTriggerDtoType_ {
    /// Wire value `balance`.
    #[serde(rename = "balance")]
    Balance,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AutoRechargeTriggeredResponse {
    /// Whether the server initiated an auto-recharge charge after this debit (TOPUP credit lands via webhook)
    #[serde(rename = "triggered")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub triggered: Option<bool>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BulkCreateUsageRequest {
    /// Generated wire DTO.
    #[serde(rename = "events")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub events: Option<Vec<BulkCreateUsageRequestEventsItem>>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BulkCreateUsageRequestEventsItem {
    /// Generated wire DTO.
    #[serde(rename = "actionType")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action_type: Option<BulkCreateUsageRequestEventsItemActionType>,
    /// Generated wire DTO.
    #[serde(rename = "customerRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub customer_ref: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "description")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "duration")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "errorMessage")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "idempotencyKey")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub idempotency_key: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "metadata")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<BTreeMap<String, Value>>,
    /// Generated wire DTO.
    #[serde(rename = "outcome")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcome: Option<BulkCreateUsageRequestEventsItemOutcome>,
    /// Generated wire DTO.
    #[serde(rename = "productRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_ref: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "purchaseRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub purchase_ref: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "timestamp")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "units")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub units: Option<i64>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum BulkCreateUsageRequestEventsItemActionType {
    /// Wire value `api_call`.
    #[serde(rename = "api_call")]
    ApiCall,
    /// Wire value `custom`.
    #[serde(rename = "custom")]
    Custom,
    /// Wire value `email`.
    #[serde(rename = "email")]
    Email,
    /// Wire value `hour`.
    #[serde(rename = "hour")]
    Hour,
    /// Wire value `storage`.
    #[serde(rename = "storage")]
    Storage,
    /// Wire value `transaction`.
    #[serde(rename = "transaction")]
    Transaction,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum BulkCreateUsageRequestEventsItemOutcome {
    /// Wire value `fail`.
    #[serde(rename = "fail")]
    Fail,
    /// Wire value `paywall`.
    #[serde(rename = "paywall")]
    Paywall,
    /// Wire value `success`.
    #[serde(rename = "success")]
    Success,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BulkUsageResponse {
    /// Number of usage events inserted
    #[serde(rename = "inserted")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inserted: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "results")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub results: Option<Vec<BulkUsageResultResponse>>,
    /// Generated wire DTO.
    #[serde(rename = "success")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub success: Option<bool>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BulkUsageResultResponse {
    /// Generated wire DTO.
    #[serde(rename = "creditDebit")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credit_debit: Option<BulkUsageResultResponseCreditDebit>,
    /// Generated wire DTO.
    #[serde(rename = "reference")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference: Option<String>,
}

/// Union for `BulkUsageResultResponse.creditDebit`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
#[allow(clippy::large_enum_variant)]
pub enum BulkUsageResultResponseCreditDebit {
    /// Variant `CreditDebitSkippedResponse`.
    CreditDebitSkippedResponse(CreditDebitSkippedResponse),
    /// Variant `CreditDebitSuccessResponse`.
    CreditDebitSuccessResponse(CreditDebitSuccessResponse),
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BusinessDetailsDto {
    /// Legal business name
    #[serde(rename = "businessName")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub business_name: Option<String>,
    /// ISO 3166-1 alpha-2 country code
    #[serde(rename = "country")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub country: Option<String>,
    /// Customer reference to persist business tax details on the customer record
    #[serde(rename = "customerRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub customer_ref: Option<String>,
    /// Whether the purchase is on behalf of a business
    #[serde(rename = "isBusiness")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_business: Option<bool>,
    /// Tax / VAT identification number
    #[serde(rename = "taxId")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tax_id: Option<String>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CancelPurchaseRequest {
    /// Generated wire DTO.
    #[serde(rename = "reason")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CheckLimitRequest {
    /// Generated wire DTO.
    #[serde(rename = "customerRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub customer_ref: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "includeCheckoutSession")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub include_checkout_session: Option<bool>,
    /// Generated wire DTO.
    #[serde(rename = "meterName")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meter_name: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "productRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_ref: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "usageType")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage_type: Option<String>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CloneProductDto {
    /// Generated wire DTO.
    #[serde(rename = "name")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConfigureMcpPlansDto {
    /// Generated wire DTO.
    #[serde(rename = "plans")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plans: Option<Vec<ConfigureMcpPlansDtoPlansItem>>,
    /// Generated wire DTO.
    #[serde(rename = "toolMapping")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_mapping: Option<Vec<ConfigureMcpPlansDtoToolMappingItem>>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConfigureMcpPlansDtoPlansItem {
    /// Generated wire DTO.
    #[serde(rename = "billingCycle")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub billing_cycle: Option<ConfigureMcpPlansDtoPlansItemBillingCycle>,
    /// Generated wire DTO.
    #[serde(rename = "billingModel")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub billing_model: Option<ConfigureMcpPlansDtoPlansItemBillingModel>,
    /// Generated wire DTO.
    #[serde(rename = "creditsPerUnit")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credits_per_unit: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "currency")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "features")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub features: Option<BTreeMap<String, Value>>,
    /// Generated wire DTO.
    #[serde(rename = "freeUnits")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub free_units: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "key")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "limit")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "name")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "price")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub price: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "pricingOptions")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pricing_options: Option<Vec<ConfigureMcpPlansDtoPlansItemPricingOptionsItem>>,
    /// Generated wire DTO.
    #[serde(rename = "type")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub type_: Option<ConfigureMcpPlansDtoPlansItemType_>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConfigureMcpPlansDtoPlansItemBillingCycle {
    /// Wire value `custom`.
    #[serde(rename = "custom")]
    Custom,
    /// Wire value `monthly`.
    #[serde(rename = "monthly")]
    Monthly,
    /// Wire value `quarterly`.
    #[serde(rename = "quarterly")]
    Quarterly,
    /// Wire value `weekly`.
    #[serde(rename = "weekly")]
    Weekly,
    /// Wire value `yearly`.
    #[serde(rename = "yearly")]
    Yearly,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConfigureMcpPlansDtoPlansItemBillingModel {
    /// Wire value `post-paid`.
    #[serde(rename = "post-paid")]
    PostPaid,
    /// Wire value `pre-paid`.
    #[serde(rename = "pre-paid")]
    PrePaid,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConfigureMcpPlansDtoPlansItemPricingOptionsItem {
    /// Generated wire DTO.
    #[serde(rename = "basePrice")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_price: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "currency")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "default")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<bool>,
    /// Generated wire DTO.
    #[serde(rename = "price")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub price: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "setupFee")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub setup_fee: Option<f64>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConfigureMcpPlansDtoPlansItemType_ {
    /// Wire value `one-time`.
    #[serde(rename = "one-time")]
    OneTime,
    /// Wire value `recurring`.
    #[serde(rename = "recurring")]
    Recurring,
    /// Wire value `usage-based`.
    #[serde(rename = "usage-based")]
    UsageBased,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConfigureMcpPlansDtoToolMappingItem {
    /// Generated wire DTO.
    #[serde(rename = "name")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "planKeys")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_keys: Option<Vec<String>>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConfigureMcpPlansResult {
    /// Updated MCP server identity
    #[serde(rename = "mcpServer")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mcp_server: Option<BTreeMap<String, Value>>,
    /// Resolved plan mapping by key (includes existing free plan)
    #[serde(rename = "planMap")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_map: Option<BTreeMap<String, Value>>,
    /// Updated product
    #[serde(rename = "product")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product: Option<SdkProductResponse>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreateCheckoutSessionRequest {
    /// Generated wire DTO.
    #[serde(rename = "customerRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub customer_ref: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "planRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_ref: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "productRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_ref: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "purpose")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub purpose: Option<CreateCheckoutSessionRequestPurpose>,
    /// Generated wire DTO.
    #[serde(rename = "returnUrl")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub return_url: Option<String>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum CreateCheckoutSessionRequestPurpose {
    /// Wire value `credit_topup`.
    #[serde(rename = "credit_topup")]
    CreditTopup,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreateCheckoutSessionResponse {
    /// Full checkout URL based on backend configuration (ready to redirect customer)
    #[serde(rename = "checkoutUrl")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkout_url: Option<String>,
    /// Checkout session ID/token
    #[serde(rename = "sessionId")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreateCustomerRequest {
    /// Generated wire DTO.
    #[serde(rename = "description")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "email")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "externalRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_ref: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "metadata")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<BTreeMap<String, Value>>,
    /// Generated wire DTO.
    #[serde(rename = "name")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "telephone")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub telephone: Option<String>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreateCustomerSessionRequest {
    /// Generated wire DTO.
    #[serde(rename = "customerRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub customer_ref: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "productRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_ref: Option<String>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreateCustomerSessionResponse {
    /// Full customer URL based on backend configuration (ready to redirect customer)
    #[serde(rename = "customerUrl")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub customer_url: Option<String>,
    /// Customer session ID/token
    #[serde(rename = "sessionId")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreatePaymentIntentDto {
    /// Generated wire DTO.
    #[serde(rename = "amount")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub amount: Option<i64>,
    /// Generated wire DTO.
    #[serde(rename = "autoRecharge")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_recharge: Option<CreatePaymentIntentDtoAutoRecharge>,
    /// Generated wire DTO.
    #[serde(rename = "currency")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "customerRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub customer_ref: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "description")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "planRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_ref: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "pricingTier")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pricing_tier: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "productRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_ref: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "purpose")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub purpose: Option<CreatePaymentIntentDtoPurpose>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreatePaymentIntentDtoAutoRecharge {
    /// Generated wire DTO.
    #[serde(rename = "currency")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "enabled")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    /// Generated wire DTO.
    #[serde(rename = "maxMonthlySpendMajor")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_monthly_spend_major: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "thresholdAmountMajor")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub threshold_amount_major: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "topupAmountMajor")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub topup_amount_major: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "triggerType")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trigger_type: Option<CreatePaymentIntentDtoAutoRechargeTriggerType>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum CreatePaymentIntentDtoAutoRechargeTriggerType {
    /// Wire value `balance`.
    #[serde(rename = "balance")]
    Balance,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum CreatePaymentIntentDtoPurpose {
    /// Wire value `credit_topup`.
    #[serde(rename = "credit_topup")]
    CreditTopup,
    /// Wire value `product`.
    #[serde(rename = "product")]
    Product,
    /// Wire value `usage_billing`.
    #[serde(rename = "usage_billing")]
    UsageBilling,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreatePlanRequest {
    /// Generated wire DTO.
    #[serde(rename = "accessExpiryDays")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub access_expiry_days: Option<i64>,
    /// Generated wire DTO.
    #[serde(rename = "autoRenew")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_renew: Option<bool>,
    /// Generated wire DTO.
    #[serde(rename = "basePrice")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_price: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "billingCycle")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub billing_cycle: Option<CreatePlanRequestBillingCycle>,
    /// Generated wire DTO.
    #[serde(rename = "billingModel")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub billing_model: Option<CreatePlanRequestBillingModel>,
    /// Generated wire DTO.
    #[serde(rename = "billingStrategy")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub billing_strategy: Option<CreatePlanRequestBillingStrategy>,
    /// Generated wire DTO.
    #[serde(rename = "cancellationNoticeDays")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cancellation_notice_days: Option<i64>,
    /// Generated wire DTO.
    #[serde(rename = "creditsPerUnit")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credits_per_unit: Option<i64>,
    /// Generated wire DTO.
    #[serde(rename = "currency")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "default")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<bool>,
    /// Generated wire DTO.
    #[serde(rename = "description")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "features")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub features: Option<BTreeMap<String, Value>>,
    /// Generated wire DTO.
    #[serde(rename = "freeUnits")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub free_units: Option<i64>,
    /// Generated wire DTO.
    #[serde(rename = "fulfillment")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fulfillment: Option<CreatePlanRequestFulfillment>,
    /// Generated wire DTO.
    #[serde(rename = "hidden")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
    /// Generated wire DTO.
    #[serde(rename = "limit")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<i64>,
    /// Generated wire DTO.
    #[serde(rename = "limits")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limits: Option<BTreeMap<String, Value>>,
    /// Generated wire DTO.
    #[serde(rename = "maxActiveUsers")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_active_users: Option<i64>,
    /// Generated wire DTO.
    #[serde(rename = "metadata")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<BTreeMap<String, Value>>,
    /// Generated wire DTO.
    #[serde(rename = "name")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "overagePolicy")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub overage_policy: Option<CreatePlanRequestOveragePolicy>,
    /// Generated wire DTO.
    #[serde(rename = "price")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub price: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "pricingOptions")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pricing_options: Option<Vec<CreatePlanRequestPricingOptionsItem>>,
    /// Generated wire DTO.
    #[serde(rename = "prorationPolicy")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proration_policy: Option<CreatePlanRequestProrationPolicy>,
    /// Generated wire DTO.
    #[serde(rename = "returnPolicy")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub return_policy: Option<CreatePlanRequestReturnPolicy>,
    /// Generated wire DTO.
    #[serde(rename = "rolloverUnusedUnits")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rollover_unused_units: Option<bool>,
    /// Generated wire DTO.
    #[serde(rename = "setupFee")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub setup_fee: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "status")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<CreatePlanRequestStatus>,
    /// Generated wire DTO.
    #[serde(rename = "taxBehavior")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tax_behavior: Option<CreatePlanRequestTaxBehavior>,
    /// Generated wire DTO.
    #[serde(rename = "trialDays")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trial_days: Option<i64>,
    /// Generated wire DTO.
    #[serde(rename = "type")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub type_: Option<CreatePlanRequestType_>,
    /// Generated wire DTO.
    #[serde(rename = "usageTracking")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage_tracking: Option<CreatePlanRequestUsageTracking>,
    /// Generated wire DTO.
    #[serde(rename = "warranty")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warranty: Option<CreatePlanRequestWarranty>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum CreatePlanRequestBillingCycle {
    /// Wire value `custom`.
    #[serde(rename = "custom")]
    Custom,
    /// Wire value `monthly`.
    #[serde(rename = "monthly")]
    Monthly,
    /// Wire value `quarterly`.
    #[serde(rename = "quarterly")]
    Quarterly,
    /// Wire value `weekly`.
    #[serde(rename = "weekly")]
    Weekly,
    /// Wire value `yearly`.
    #[serde(rename = "yearly")]
    Yearly,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum CreatePlanRequestBillingModel {
    /// Wire value `post-paid`.
    #[serde(rename = "post-paid")]
    PostPaid,
    /// Wire value `pre-paid`.
    #[serde(rename = "pre-paid")]
    PrePaid,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreatePlanRequestBillingStrategy {
    /// Generated wire DTO.
    #[serde(rename = "type")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub type_: Option<String>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreatePlanRequestFulfillment {
    /// Generated wire DTO.
    #[serde(rename = "deliveryMethod")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivery_method: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "estimatedDelivery")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub estimated_delivery: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "type")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub type_: Option<String>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreatePlanRequestOveragePolicy {
    /// Generated wire DTO.
    #[serde(rename = "allowOverage")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allow_overage: Option<bool>,
    /// Generated wire DTO.
    #[serde(rename = "maxOverage")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_overage: Option<f64>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreatePlanRequestPricingOptionsItem {
    /// Generated wire DTO.
    #[serde(rename = "basePrice")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_price: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "currency")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "default")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<bool>,
    /// Generated wire DTO.
    #[serde(rename = "price")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub price: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "setupFee")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub setup_fee: Option<f64>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreatePlanRequestProrationPolicy {
    /// Generated wire DTO.
    #[serde(rename = "enabled")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    /// Generated wire DTO.
    #[serde(rename = "method")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub method: Option<CreatePlanRequestProrationPolicyMethod>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum CreatePlanRequestProrationPolicyMethod {
    /// Wire value `full`.
    #[serde(rename = "full")]
    Full,
    /// Wire value `none`.
    #[serde(rename = "none")]
    None,
    /// Wire value `proportional`.
    #[serde(rename = "proportional")]
    Proportional,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreatePlanRequestReturnPolicy {
    /// Generated wire DTO.
    #[serde(rename = "allowed")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allowed: Option<bool>,
    /// Generated wire DTO.
    #[serde(rename = "conditions")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conditions: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "period")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub period: Option<f64>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum CreatePlanRequestStatus {
    /// Wire value `active`.
    #[serde(rename = "active")]
    Active,
    /// Wire value `archived`.
    #[serde(rename = "archived")]
    Archived,
    /// Wire value `inactive`.
    #[serde(rename = "inactive")]
    Inactive,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum CreatePlanRequestTaxBehavior {
    /// Wire value `auto`.
    #[serde(rename = "auto")]
    Auto,
    /// Wire value `exclusive`.
    #[serde(rename = "exclusive")]
    Exclusive,
    /// Wire value `inclusive`.
    #[serde(rename = "inclusive")]
    Inclusive,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum CreatePlanRequestType_ {
    /// Wire value `hybrid`.
    #[serde(rename = "hybrid")]
    Hybrid,
    /// Wire value `one-time`.
    #[serde(rename = "one-time")]
    OneTime,
    /// Wire value `recurring`.
    #[serde(rename = "recurring")]
    Recurring,
    /// Wire value `usage-based`.
    #[serde(rename = "usage-based")]
    UsageBased,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreatePlanRequestUsageTracking {
    /// Generated wire DTO.
    #[serde(rename = "granularity")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub granularity: Option<CreatePlanRequestUsageTrackingGranularity>,
    /// Generated wire DTO.
    #[serde(rename = "method")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub method: Option<CreatePlanRequestUsageTrackingMethod>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum CreatePlanRequestUsageTrackingGranularity {
    /// Wire value `daily`.
    #[serde(rename = "daily")]
    Daily,
    /// Wire value `hourly`.
    #[serde(rename = "hourly")]
    Hourly,
    /// Wire value `monthly`.
    #[serde(rename = "monthly")]
    Monthly,
    /// Wire value `weekly`.
    #[serde(rename = "weekly")]
    Weekly,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum CreatePlanRequestUsageTrackingMethod {
    /// Wire value `automatic`.
    #[serde(rename = "automatic")]
    Automatic,
    /// Wire value `hybrid`.
    #[serde(rename = "hybrid")]
    Hybrid,
    /// Wire value `manual`.
    #[serde(rename = "manual")]
    Manual,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreatePlanRequestWarranty {
    /// Generated wire DTO.
    #[serde(rename = "duration")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "terms")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terms: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "unit")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreateProductRequest {
    /// Generated wire DTO.
    #[serde(rename = "config")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config: Option<CreateProductRequestConfig>,
    /// Generated wire DTO.
    #[serde(rename = "description")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "imageUrl")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_url: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "isMcpPay")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_mcp_pay: Option<bool>,
    /// Generated wire DTO.
    #[serde(rename = "metadata")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<BTreeMap<String, Value>>,
    /// Generated wire DTO.
    #[serde(rename = "name")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "productType")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_type: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "taxBehavior")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tax_behavior: Option<CreateProductRequestTaxBehavior>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreateProductRequestConfig {
    /// Generated wire DTO.
    #[serde(rename = "deliveryMethod")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivery_method: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "fulfillmentType")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fulfillment_type: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "validityPeriod")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub validity_period: Option<i64>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum CreateProductRequestTaxBehavior {
    /// Wire value `auto`.
    #[serde(rename = "auto")]
    Auto,
    /// Wire value `exclusive`.
    #[serde(rename = "exclusive")]
    Exclusive,
    /// Wire value `inclusive`.
    #[serde(rename = "inclusive")]
    Inclusive,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreateUsageRequest {
    /// Generated wire DTO.
    #[serde(rename = "actionType")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action_type: Option<CreateUsageRequestActionType>,
    /// Generated wire DTO.
    #[serde(rename = "customerRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub customer_ref: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "description")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "duration")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "errorMessage")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "idempotencyKey")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub idempotency_key: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "metadata")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<BTreeMap<String, Value>>,
    /// Generated wire DTO.
    #[serde(rename = "outcome")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcome: Option<CreateUsageRequestOutcome>,
    /// Generated wire DTO.
    #[serde(rename = "productRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_ref: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "purchaseRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub purchase_ref: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "timestamp")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "units")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub units: Option<i64>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum CreateUsageRequestActionType {
    /// Wire value `api_call`.
    #[serde(rename = "api_call")]
    ApiCall,
    /// Wire value `custom`.
    #[serde(rename = "custom")]
    Custom,
    /// Wire value `email`.
    #[serde(rename = "email")]
    Email,
    /// Wire value `hour`.
    #[serde(rename = "hour")]
    Hour,
    /// Wire value `storage`.
    #[serde(rename = "storage")]
    Storage,
    /// Wire value `transaction`.
    #[serde(rename = "transaction")]
    Transaction,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum CreateUsageRequestOutcome {
    /// Wire value `fail`.
    #[serde(rename = "fail")]
    Fail,
    /// Wire value `paywall`.
    #[serde(rename = "paywall")]
    Paywall,
    /// Wire value `success`.
    #[serde(rename = "success")]
    Success,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreditDebitSkippedResponse {
    /// Generated wire DTO.
    #[serde(rename = "debited")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub debited: Option<bool>,
    /// Reason no credit debit was recorded
    #[serde(rename = "reason")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<CreditDebitSkippedResponseReason>,
}

/// Reason no credit debit was recorded
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum CreditDebitSkippedResponseReason {
    /// Wire value `customer_not_found`.
    #[serde(rename = "customer_not_found")]
    CustomerNotFound,
    /// Wire value `duplicate`.
    #[serde(rename = "duplicate")]
    Duplicate,
    /// Wire value `no_active_purchase`.
    #[serde(rename = "no_active_purchase")]
    NoActivePurchase,
    /// Wire value `no_product_ref`.
    #[serde(rename = "no_product_ref")]
    NoProductRef,
    /// Wire value `plan_not_credit_based`.
    #[serde(rename = "plan_not_credit_based")]
    PlanNotCreditBased,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreditDebitSuccessResponse {
    /// Credits debited for this usage event
    #[serde(rename = "amount")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub amount: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "autoRecharge")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_recharge: Option<AutoRechargeTriggeredResponse>,
    /// Generated wire DTO.
    #[serde(rename = "debited")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub debited: Option<bool>,
    /// Estimated remaining units after debit
    #[serde(rename = "unitsRemaining")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub units_remaining: Option<f64>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CustomerBalanceDisplayDto {
    /// Balance amount in the display currency major units (e.g. dollars)
    #[serde(rename = "amountMajor")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub amount_major: Option<f64>,
    /// ISO 4217 display currency code
    #[serde(rename = "currency")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    /// Exchange rate applied from USD to the display currency
    #[serde(rename = "exchangeRate")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exchange_rate: Option<f64>,
    /// Human-readable formatted balance
    #[serde(rename = "formatted")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formatted: Option<String>,
    /// Source of the exchange rate used
    #[serde(rename = "rateSource")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rate_source: Option<CustomerBalanceDisplayDtoRateSource>,
}

/// Source of the exchange rate used
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum CustomerBalanceDisplayDtoRateSource {
    /// Wire value `db`.
    #[serde(rename = "db")]
    Db,
    /// Wire value `fallback`.
    #[serde(rename = "fallback")]
    Fallback,
    /// Wire value `parity`.
    #[serde(rename = "parity")]
    Parity,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CustomerBalanceResponse {
    /// Raw credit balance in credits (mils)
    #[serde(rename = "credits")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credits: Option<f64>,
    /// Number of credits per minor currency unit
    #[serde(rename = "creditsPerMinorUnit")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credits_per_minor_unit: Option<f64>,
    /// Customer reference identifier
    #[serde(rename = "customerRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub customer_ref: Option<String>,
    /// Formatted balance display block for the display currency
    #[serde(rename = "display")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display: Option<CustomerBalanceDisplayDto>,
    /// ISO 4217 display currency code
    #[serde(rename = "displayCurrency")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_currency: Option<String>,
    /// Exchange rate from USD to the display currency
    #[serde(rename = "displayExchangeRate")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_exchange_rate: Option<f64>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CustomerResponse {
    /// Customer email address
    #[serde(rename = "email")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    /// External reference ID from your auth system (if set during creation or update)
    #[serde(rename = "externalRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_ref: Option<String>,
    /// Customer full name
    #[serde(rename = "name")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Active purchases
    #[serde(rename = "purchases")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub purchases: Option<Vec<PurchaseInfo>>,
    /// Customer reference identifier
    #[serde(rename = "reference")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference: Option<String>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DeletePlansResponse {
    /// Generated wire DTO.
    #[serde(rename = "success")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub success: Option<bool>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DeleteProductsResponse {
    /// Outcome of the delete: hard delete in sandbox, soft-delete or deactivation in live depending on existing purchases
    #[serde(rename = "action")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<DeleteProductsResponseAction>,
    /// Generated wire DTO.
    #[serde(rename = "success")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub success: Option<bool>,
}

/// Outcome of the delete: hard delete in sandbox, soft-delete or deactivation in live depending on existing purchases
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum DeleteProductsResponseAction {
    /// Wire value `deactivated`.
    #[serde(rename = "deactivated")]
    Deactivated,
    /// Wire value `deleted`.
    #[serde(rename = "deleted")]
    Deleted,
    /// Wire value `soft_deleted`.
    #[serde(rename = "soft_deleted")]
    SoftDeleted,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DisableAutoRechargeResponse {
    /// Always true on success
    #[serde(rename = "success")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub success: Option<bool>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GetCustomerResponse {
    /// Generated wire DTO.
    #[serde(rename = "purchases")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub purchases: Option<Vec<SdkPurchaseResponse>>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GetCustomerSessionResponse {
    /// Session creation date
    #[serde(rename = "createdAt")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    /// Customer object from session data
    #[serde(rename = "customer")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub customer: Option<CustomerResponse>,
    /// Full customer URL based on backend configuration (ready to redirect customer)
    #[serde(rename = "customerUrl")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub customer_url: Option<String>,
    /// Session expiration date
    #[serde(rename = "expiresAt")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    /// Customer session ID/token
    #[serde(rename = "sessionId")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    /// Session status
    #[serde(rename = "status")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<GetCustomerSessionResponseStatus>,
    /// Session last update date
    #[serde(rename = "updatedAt")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

/// Session status
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum GetCustomerSessionResponseStatus {
    /// Wire value `active`.
    #[serde(rename = "active")]
    Active,
    /// Wire value `expired`.
    #[serde(rename = "expired")]
    Expired,
    /// Wire value `used`.
    #[serde(rename = "used")]
    Used,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GetPlansResponse {
    /// Generated wire DTO.
    #[serde(rename = "limit")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "offset")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub offset: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "plans")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plans: Option<Vec<Plan>>,
    /// Total number of plans for the product
    #[serde(rename = "total")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total: Option<f64>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GetProductResponse {
    /// Generated wire DTO.
    #[serde(rename = "purchases")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub purchases: Option<Vec<SdkPurchaseResponse>>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GetProductsResponse {
    /// Applied page size (clamped to 1-100)
    #[serde(rename = "limit")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<f64>,
    /// Applied pagination offset
    #[serde(rename = "offset")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub offset: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "products")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub products: Option<Vec<SdkProductResponse>>,
    /// Total number of products matching the filters
    #[serde(rename = "total")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total: Option<f64>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GetPurchasesResponse {
    /// Generated wire DTO.
    #[serde(rename = "purchases")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub purchases: Option<Vec<SdkPurchaseResponse>>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GrantCustomerCreditsRequest {
    /// Generated wire DTO.
    #[serde(rename = "credits")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credits: Option<i64>,
    /// Generated wire DTO.
    #[serde(rename = "reason")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GrantCustomerCreditsResponse {
    /// Customer credit balance after the grant
    #[serde(rename = "balance")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub balance: Option<f64>,
    /// Granted credit amount
    #[serde(rename = "credits")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credits: Option<f64>,
    /// Customer reference identifier
    #[serde(rename = "customerRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub customer_ref: Option<String>,
    /// Machine-readable grant reason
    #[serde(rename = "reason")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// Whether the grant was recorded
    #[serde(rename = "success")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub success: Option<bool>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LimitBalanceDto {
    /// Credit balance in mils
    #[serde(rename = "creditBalance")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credit_balance: Option<f64>,
    /// Credits per usage unit
    #[serde(rename = "creditsPerUnit")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credits_per_unit: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "currency")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    /// Estimated whole units remaining from prepaid credit balance
    #[serde(rename = "remainingUnits")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remaining_units: Option<f64>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LimitPlanItemDto {
    /// Generated wire DTO.
    #[serde(rename = "billingCycle")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub billing_cycle: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "billingModel")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub billing_model: Option<String>,
    /// Credits per usage unit (usage-based plans)
    #[serde(rename = "creditsPerUnit")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credits_per_unit: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "currency")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "freeUnits")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub free_units: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "name")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Price in smallest currency unit (e.g. cents)
    #[serde(rename = "price")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub price: Option<f64>,
    /// Per-currency price options for this plan
    #[serde(rename = "pricingOptions")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pricing_options: Option<Vec<PlanPricingOptionDto>>,
    /// Generated wire DTO.
    #[serde(rename = "reference")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "requiresPayment")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requires_payment: Option<bool>,
    /// Generated wire DTO.
    #[serde(rename = "type")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub type_: Option<String>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LimitProductBriefDto {
    /// Generated wire DTO.
    #[serde(rename = "name")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "reference")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference: Option<String>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LimitResponse {
    /// True when the customer must activate a priced default plan before usage is allowed
    #[serde(rename = "activationRequired")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub activation_required: Option<bool>,
    /// Prepaid usage balance context when the default plan is usage-based
    #[serde(rename = "balance")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub balance: Option<LimitBalanceDto>,
    /// Checkout session ID if payment is required
    #[serde(rename = "checkoutSessionId")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkout_session_id: Option<String>,
    /// Checkout URL if payment is required
    #[serde(rename = "checkoutUrl")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkout_url: Option<String>,
    /// Customer portal confirmation URL when activation is required (fallback when not starting checkout)
    #[serde(rename = "confirmationUrl")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confirmation_url: Option<String>,
    /// Credit balance in mils (for pre-paid usage-based plans)
    #[serde(rename = "creditBalance")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credit_balance: Option<f64>,
    /// Credits per usage unit (for pre-paid usage-based plans)
    #[serde(rename = "creditsPerUnit")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credits_per_unit: Option<f64>,
    /// ISO 4217 currency code for credit fields
    #[serde(rename = "currency")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    /// The meter name to use when tracking usage events
    #[serde(rename = "meterName")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meter_name: Option<String>,
    /// Active plans on the product available for activation or checkout
    #[serde(rename = "plans")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plans: Option<Vec<LimitPlanItemDto>>,
    /// Product the limit check applies to
    #[serde(rename = "product")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product: Option<LimitProductBriefDto>,
    /// Remaining usage units before hitting the limit
    #[serde(rename = "remaining")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remaining: Option<f64>,
    /// Whether the customer is within their usage limits
    #[serde(rename = "withinLimits")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub within_limits: Option<bool>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct McpBootstrapDto {
    /// Generated wire DTO.
    #[serde(rename = "authApiKey")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_api_key: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "authHeaderName")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_header_name: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "description")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "imageUrl")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_url: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "mcpDomain")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mcp_domain: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "metadata")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<BTreeMap<String, Value>>,
    /// Generated wire DTO.
    #[serde(rename = "name")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "originUrl")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin_url: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "plans")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plans: Option<Vec<McpBootstrapDtoPlansItem>>,
    /// Generated wire DTO.
    #[serde(rename = "productType")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_type: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "tools")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<McpBootstrapDtoToolsItem>>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct McpBootstrapDtoPlansItem {
    /// Generated wire DTO.
    #[serde(rename = "billingCycle")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub billing_cycle: Option<McpBootstrapDtoPlansItemBillingCycle>,
    /// Generated wire DTO.
    #[serde(rename = "billingModel")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub billing_model: Option<McpBootstrapDtoPlansItemBillingModel>,
    /// Generated wire DTO.
    #[serde(rename = "creditsPerUnit")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credits_per_unit: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "currency")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "features")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub features: Option<BTreeMap<String, Value>>,
    /// Generated wire DTO.
    #[serde(rename = "freeUnits")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub free_units: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "key")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "limit")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "name")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "price")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub price: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "pricingOptions")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pricing_options: Option<Vec<McpBootstrapDtoPlansItemPricingOptionsItem>>,
    /// Generated wire DTO.
    #[serde(rename = "type")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub type_: Option<McpBootstrapDtoPlansItemType_>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum McpBootstrapDtoPlansItemBillingCycle {
    /// Wire value `custom`.
    #[serde(rename = "custom")]
    Custom,
    /// Wire value `monthly`.
    #[serde(rename = "monthly")]
    Monthly,
    /// Wire value `quarterly`.
    #[serde(rename = "quarterly")]
    Quarterly,
    /// Wire value `weekly`.
    #[serde(rename = "weekly")]
    Weekly,
    /// Wire value `yearly`.
    #[serde(rename = "yearly")]
    Yearly,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum McpBootstrapDtoPlansItemBillingModel {
    /// Wire value `post-paid`.
    #[serde(rename = "post-paid")]
    PostPaid,
    /// Wire value `pre-paid`.
    #[serde(rename = "pre-paid")]
    PrePaid,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct McpBootstrapDtoPlansItemPricingOptionsItem {
    /// Generated wire DTO.
    #[serde(rename = "basePrice")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_price: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "currency")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "default")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<bool>,
    /// Generated wire DTO.
    #[serde(rename = "price")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub price: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "setupFee")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub setup_fee: Option<f64>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum McpBootstrapDtoPlansItemType_ {
    /// Wire value `one-time`.
    #[serde(rename = "one-time")]
    OneTime,
    /// Wire value `recurring`.
    #[serde(rename = "recurring")]
    Recurring,
    /// Wire value `usage-based`.
    #[serde(rename = "usage-based")]
    UsageBased,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct McpBootstrapDtoToolsItem {
    /// Generated wire DTO.
    #[serde(rename = "description")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "name")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "noPlan")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub no_plan: Option<bool>,
    /// Generated wire DTO.
    #[serde(rename = "planKeys")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_keys: Option<Vec<String>>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct McpBootstrapResult {
    /// Auto-discovered tools used during bootstrap
    #[serde(rename = "autoMappedTools")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_mapped_tools: Option<Vec<McpBootstrapResultAutoMappedToolsItem>>,
    /// Created or updated MCP server identity
    #[serde(rename = "mcpServer")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mcp_server: Option<BTreeMap<String, Value>>,
    /// Resolved plan mapping by bootstrap key
    #[serde(rename = "planMap")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_map: Option<BTreeMap<String, Value>>,
    /// Created product
    #[serde(rename = "product")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product: Option<SdkProductResponse>,
    /// True when tools were auto-discovered from origin because the request omitted tools
    #[serde(rename = "toolsAutoMapped")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tools_auto_mapped: Option<bool>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct McpBootstrapResultAutoMappedToolsItem {
    /// Generated wire DTO.
    #[serde(rename = "description")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "name")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OneTimePurchaseInfo {
    /// Amount in USD cents (normalised for aggregation)
    #[serde(rename = "amount")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub amount: Option<f64>,
    /// When the one-time purchase was completed
    #[serde(rename = "completedAt")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    /// ISO 4217 currency code of the customer-facing charge
    #[serde(rename = "currency")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    /// Product reference
    #[serde(rename = "productRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_ref: Option<String>,
    /// Purchase reference
    #[serde(rename = "reference")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference: Option<String>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PaymentMethodCard {
    /// Generated wire DTO.
    #[serde(rename = "brand")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub brand: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "expMonth")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exp_month: Option<i64>,
    /// Generated wire DTO.
    #[serde(rename = "expYear")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exp_year: Option<i64>,
    /// Generated wire DTO.
    #[serde(rename = "kind")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<PaymentMethodCardKind>,
    /// Generated wire DTO.
    #[serde(rename = "last4")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last4: Option<String>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum PaymentMethodCardKind {
    /// Wire value `card`.
    #[serde(rename = "card")]
    Card,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PaymentMethodNone {
    /// Generated wire DTO.
    #[serde(rename = "kind")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<PaymentMethodNoneKind>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum PaymentMethodNoneKind {
    /// Wire value `none`.
    #[serde(rename = "none")]
    None,
}

/// Default payment method on file, or `kind: none` when absent.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
#[allow(clippy::large_enum_variant)]
pub enum PaymentMethodResult {
    /// Variant `Card`.
    Card(PaymentMethodCard),
    /// Variant `None`.
    None(PaymentMethodNone),
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Plan {
    /// Access expiry in days
    #[serde(rename = "accessExpiryDays")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub access_expiry_days: Option<f64>,
    /// Billing cycle
    #[serde(rename = "billingCycle")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub billing_cycle: Option<String>,
    /// Billing model
    #[serde(rename = "billingModel")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub billing_model: Option<PlanBillingModel>,
    /// Creation timestamp
    #[serde(rename = "createdAt")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    /// Credits per usage unit (integer, >= 1)
    #[serde(rename = "creditsPerUnit")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credits_per_unit: Option<f64>,
    /// Currency code (ISO 4217)
    #[serde(rename = "currency")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    /// Currency symbol (derived from currency)
    #[serde(rename = "currencySymbol")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency_symbol: Option<String>,
    /// Plan description
    #[serde(rename = "description")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Plan features
    #[serde(rename = "features")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub features: Option<BTreeMap<String, Value>>,
    /// Number of free units included
    #[serde(rename = "freeUnits")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub free_units: Option<f64>,
    /// Whether the plan is hidden from customer-facing surfaces. When true, the plan does not appear in checkout or the SDK catalog and can only be granted via direct assignment (enterprise plans).
    #[serde(rename = "hidden")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
    /// Whether the plan is active (derived from status)
    #[serde(rename = "isActive")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_active: Option<bool>,
    /// Usage limit for the meter
    #[serde(rename = "limit")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<f64>,
    /// Usage limits
    #[serde(rename = "limits")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limits: Option<BTreeMap<String, Value>>,
    /// Maximum number of active users
    #[serde(rename = "maxActiveUsers")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_active_users: Option<f64>,
    /// What the plan measures for usage tracking
    #[serde(rename = "measures")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub measures: Option<String>,
    /// Meter reference for usage-based plans
    #[serde(rename = "meterRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meter_ref: Option<String>,
    /// Plan name
    #[serde(rename = "name")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Plan price in cents
    #[serde(rename = "price")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub price: Option<f64>,
    /// Per-currency price options for this plan
    #[serde(rename = "pricingOptions")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pricing_options: Option<Vec<PlanPricingOptionDto>>,
    /// Plan reference
    #[serde(rename = "reference")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference: Option<String>,
    /// Whether payment is required
    #[serde(rename = "requiresPayment")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requires_payment: Option<bool>,
    /// Whether unused units roll over to next period
    #[serde(rename = "rolloverUnusedUnits")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rollover_unused_units: Option<bool>,
    /// One-time setup fee
    #[serde(rename = "setupFee")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub setup_fee: Option<f64>,
    /// Plan status
    #[serde(rename = "status")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// Tax inclusion behavior for business checkout
    #[serde(rename = "taxBehavior")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tax_behavior: Option<PlanTaxBehavior>,
    /// Free trial period in days
    #[serde(rename = "trialDays")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trial_days: Option<f64>,
    /// Plan type exposed in SDK
    #[serde(rename = "type")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub type_: Option<PlanType_>,
    /// Last update timestamp
    #[serde(rename = "updatedAt")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

/// Billing model
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum PlanBillingModel {
    /// Wire value `post-paid`.
    #[serde(rename = "post-paid")]
    PostPaid,
    /// Wire value `pre-paid`.
    #[serde(rename = "pre-paid")]
    PrePaid,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlanPricingOptionDto {
    /// Base price in smallest currency unit (hybrid plans)
    #[serde(rename = "basePrice")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_price: Option<f64>,
    /// ISO 4217 currency code
    #[serde(rename = "currency")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    /// Whether this is the default currency option for the plan
    #[serde(rename = "default")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<bool>,
    /// Price in smallest currency unit (e.g. cents)
    #[serde(rename = "price")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub price: Option<f64>,
    /// One-time setup fee in smallest currency unit
    #[serde(rename = "setupFee")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub setup_fee: Option<f64>,
}

/// Tax inclusion behavior for business checkout
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum PlanTaxBehavior {
    /// Wire value `auto`.
    #[serde(rename = "auto")]
    Auto,
    /// Wire value `exclusive`.
    #[serde(rename = "exclusive")]
    Exclusive,
    /// Wire value `inclusive`.
    #[serde(rename = "inclusive")]
    Inclusive,
}

/// Plan type exposed in SDK
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum PlanType_ {
    /// Wire value `hybrid`.
    #[serde(rename = "hybrid")]
    Hybrid,
    /// Wire value `one-time`.
    #[serde(rename = "one-time")]
    OneTime,
    /// Wire value `recurring`.
    #[serde(rename = "recurring")]
    Recurring,
    /// Wire value `usage-based`.
    #[serde(rename = "usage-based")]
    UsageBased,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PostBulkResponse {
    /// Generated wire DTO.
    #[serde(rename = "inserted")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inserted: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "success")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub success: Option<bool>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PostCancelResponse {
    /// Generated wire DTO.
    #[serde(rename = "purchase")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub purchase: Option<SdkPurchaseResponse>,
    /// Generated wire DTO.
    #[serde(rename = "success")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub success: Option<bool>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PostMeterEventsResponse {
    /// Generated wire DTO.
    #[serde(rename = "success")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub success: Option<bool>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PostReactivateResponse {
    /// Generated wire DTO.
    #[serde(rename = "purchase")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub purchase: Option<SdkPurchaseResponse>,
    /// Generated wire DTO.
    #[serde(rename = "success")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub success: Option<bool>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProcessPaymentCancelled {
    /// Generated wire DTO.
    #[serde(rename = "status")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<ProcessPaymentCancelledStatus>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProcessPaymentCancelledStatus {
    /// Wire value `cancelled`.
    #[serde(rename = "cancelled")]
    Cancelled,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProcessPaymentFailed {
    /// Generated wire DTO.
    #[serde(rename = "status")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<ProcessPaymentFailedStatus>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProcessPaymentFailedStatus {
    /// Wire value `failed`.
    #[serde(rename = "failed")]
    Failed,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProcessPaymentIntentDto {
    /// Generated wire DTO.
    #[serde(rename = "customerRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub customer_ref: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "planRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_ref: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "productRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_ref: Option<String>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProcessPaymentProcessing {
    /// Generated wire DTO.
    #[serde(rename = "status")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<ProcessPaymentProcessingStatus>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProcessPaymentProcessingStatus {
    /// Wire value `processing`.
    #[serde(rename = "processing")]
    Processing,
}

/// Payment intent status with optional purchase enrichment on success.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
#[allow(clippy::large_enum_variant)]
pub enum ProcessPaymentResult {
    /// Variant `SucceededRecurring`.
    SucceededRecurring(ProcessPaymentSucceededRecurring),
    /// Variant `SucceededOneTime`.
    SucceededOneTime(ProcessPaymentSucceededOneTime),
    /// Variant `Processing`.
    Processing(ProcessPaymentProcessing),
    /// Variant `Timeout`.
    Timeout(ProcessPaymentTimeout),
    /// Variant `Failed`.
    Failed(ProcessPaymentFailed),
    /// Variant `Cancelled`.
    Cancelled(ProcessPaymentCancelled),
    /// Variant `SucceededBare`.
    SucceededBare(ProcessPaymentSucceededBare),
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProcessPaymentSucceededBare {
    /// Generated wire DTO.
    #[serde(rename = "status")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<ProcessPaymentSucceededBareStatus>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProcessPaymentSucceededBareStatus {
    /// Wire value `succeeded`.
    #[serde(rename = "succeeded")]
    Succeeded,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProcessPaymentSucceededOneTime {
    /// Generated wire DTO.
    #[serde(rename = "oneTimePurchase")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub one_time_purchase: Option<OneTimePurchaseInfo>,
    /// Generated wire DTO.
    #[serde(rename = "status")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<ProcessPaymentSucceededOneTimeStatus>,
    /// Generated wire DTO.
    #[serde(rename = "type")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub type_: Option<ProcessPaymentSucceededOneTimeType_>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProcessPaymentSucceededOneTimeStatus {
    /// Wire value `succeeded`.
    #[serde(rename = "succeeded")]
    Succeeded,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProcessPaymentSucceededOneTimeType_ {
    /// Wire value `one-time`.
    #[serde(rename = "one-time")]
    OneTime,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProcessPaymentSucceededRecurring {
    /// Generated wire DTO.
    #[serde(rename = "purchase")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub purchase: Option<PurchaseInfo>,
    /// Generated wire DTO.
    #[serde(rename = "status")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<ProcessPaymentSucceededRecurringStatus>,
    /// Generated wire DTO.
    #[serde(rename = "type")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub type_: Option<ProcessPaymentSucceededRecurringType_>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProcessPaymentSucceededRecurringStatus {
    /// Wire value `succeeded`.
    #[serde(rename = "succeeded")]
    Succeeded,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProcessPaymentSucceededRecurringType_ {
    /// Wire value `recurring`.
    #[serde(rename = "recurring")]
    Recurring,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProcessPaymentTimeout {
    /// Detail message describing the timeout
    #[serde(rename = "message")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "status")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<ProcessPaymentTimeoutStatus>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProcessPaymentTimeoutStatus {
    /// Wire value `timeout`.
    #[serde(rename = "timeout")]
    Timeout,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProductConfigDto {
    /// Delivery method
    #[serde(rename = "deliveryMethod")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivery_method: Option<String>,
    /// Fulfillment type
    #[serde(rename = "fulfillmentType")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fulfillment_type: Option<String>,
    /// Validity period in days
    #[serde(rename = "validityPeriod")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub validity_period: Option<f64>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PurchaseInfo {
    /// Amount in USD cents (normalised for aggregation)
    #[serde(rename = "amount")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub amount: Option<f64>,
    /// Reason for cancellation
    #[serde(rename = "cancellationReason")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cancellation_reason: Option<String>,
    /// When purchase was cancelled
    #[serde(rename = "cancelledAt")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cancelled_at: Option<String>,
    /// ISO 4217 currency code of the customer-facing charge
    #[serde(rename = "currency")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    /// End date of purchase
    #[serde(rename = "endDate")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_date: Option<String>,
    /// Exchange rate from original currency to USD
    #[serde(rename = "exchangeRate")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exchange_rate: Option<f64>,
    /// Original amount in the payment currency (minor units)
    #[serde(rename = "originalAmount")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_amount: Option<f64>,
    /// Plan reference from the plan snapshot, for reliable plan matching
    #[serde(rename = "planRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_ref: Option<String>,
    /// Snapshot of the plan at time of purchase
    #[serde(rename = "planSnapshot")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_snapshot: Option<BTreeMap<String, Value>>,
    /// Product name
    #[serde(rename = "productName")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_name: Option<String>,
    /// Product reference
    #[serde(rename = "productRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_ref: Option<String>,
    /// Purchase reference
    #[serde(rename = "reference")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference: Option<String>,
    /// Start date
    #[serde(rename = "startDate")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_date: Option<String>,
    /// Purchase status
    #[serde(rename = "status")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PutAutoRechargeSdkDto {
    /// Generated wire DTO.
    #[serde(rename = "currency")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "customerEmail")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub customer_email: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "customerName")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub customer_name: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "customerRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub customer_ref: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "deferSetupIntent")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub defer_setup_intent: Option<bool>,
    /// Generated wire DTO.
    #[serde(rename = "enabled")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    /// Generated wire DTO.
    #[serde(rename = "maxMonthlySpendMajor")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_monthly_spend_major: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "thresholdAmountMajor")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub threshold_amount_major: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "topupAmountMajor")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub topup_amount_major: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "triggerType")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trigger_type: Option<PutAutoRechargeSdkDtoTriggerType>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum PutAutoRechargeSdkDtoTriggerType {
    /// Wire value `balance`.
    #[serde(rename = "balance")]
    Balance,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RecordBulkMeterEventsZodDto {
    /// Generated wire DTO.
    #[serde(rename = "events")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub events: Option<Vec<RecordBulkMeterEventsZodDtoEventsItem>>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RecordBulkMeterEventsZodDtoEventsItem {
    /// Generated wire DTO.
    #[serde(rename = "customerRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub customer_ref: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "meterName")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meter_name: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "productRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_ref: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "properties")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub properties: Option<BTreeMap<String, Value>>,
    /// Generated wire DTO.
    #[serde(rename = "timestamp")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "value")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<f64>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RecordMeterEventZodDto {
    /// Generated wire DTO.
    #[serde(rename = "customerRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub customer_ref: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "meterName")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meter_name: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "productRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_ref: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "properties")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub properties: Option<BTreeMap<String, Value>>,
    /// Generated wire DTO.
    #[serde(rename = "timestamp")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "value")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<f64>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SaveAutoRechargeResponse {
    /// Generated wire DTO.
    #[serde(rename = "config")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config: Option<AutoRechargeConfigDto>,
    /// Generated wire DTO.
    #[serde(rename = "display")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display: Option<AutoRechargeDisplayDto>,
    /// Stripe publishable key for the resolved environment
    #[serde(rename = "publishableKey")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub publishable_key: Option<String>,
    /// Stripe SetupIntent client secret for card collection
    #[serde(rename = "setupClientSecret")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub setup_client_secret: Option<String>,
    /// Connected Stripe account ID
    #[serde(rename = "stripeAccountId")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stripe_account_id: Option<String>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SdkMerchantResponseDto {
    /// Company registration number (EIN, Companies House No, Org No)
    #[serde(rename = "companyNumber")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub company_number: Option<String>,
    /// ISO-3166 alpha-2 country code of the merchant
    #[serde(rename = "country")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub country: Option<String>,
    /// ISO-4217 default settlement currency
    #[serde(rename = "defaultCurrency")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_currency: Option<String>,
    /// Brand name shown in UI
    #[serde(rename = "displayName")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    /// Absolute URL to the square app icon / logomark. Consumed by MCP host chromes, mobile avatar slots, and any surface where the landscape `logoUrl` would need letterboxing.
    #[serde(rename = "iconUrl")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_url: Option<String>,
    /// Legal entity name used in SCA mandate copy
    #[serde(rename = "legalName")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub legal_name: Option<String>,
    /// Absolute URL to the merchant logo
    #[serde(rename = "logoUrl")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub logo_url: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "privacyUrl")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub privacy_url: Option<String>,
    /// Descriptor appearing on the customer card statement
    #[serde(rename = "statementDescriptor")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub statement_descriptor: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "supportEmail")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub support_email: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "supportUrl")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub support_url: Option<String>,
    /// Full set of currencies a customer may pay credit topups in, including the default currency. Omitted/single-entry means single-currency behavior.
    #[serde(rename = "supportedTopupCurrencies")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supported_topup_currencies: Option<Vec<String>>,
    /// Tax identification number (US: EIN)
    #[serde(rename = "taxId")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tax_id: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "termsUrl")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terms_url: Option<String>,
    /// VAT identification number (UK/EU)
    #[serde(rename = "vatNumber")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vat_number: Option<String>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SdkPaymentIntentListItem {
    /// Amount in the charge currency (minor units)
    #[serde(rename = "amount")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub amount: Option<f64>,
    /// Client secret used to confirm the payment on the client
    #[serde(rename = "clientSecret")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_secret: Option<String>,
    /// Creation timestamp
    #[serde(rename = "createdAt")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    /// ISO 4217 currency code
    #[serde(rename = "currency")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    /// Plan reference
    #[serde(rename = "planRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_ref: Option<String>,
    /// Payment processor payment intent ID
    #[serde(rename = "processorPaymentId")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub processor_payment_id: Option<String>,
    /// Payment intent status
    #[serde(rename = "status")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SdkPaymentIntentListResponse {
    /// Generated wire DTO.
    #[serde(rename = "paymentIntents")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payment_intents: Option<Vec<SdkPaymentIntentListItem>>,
    /// Number of payment intents returned
    #[serde(rename = "total")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total: Option<f64>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SdkPaymentIntentResponse {
    /// Connected Stripe account ID (only present on create)
    #[serde(rename = "accountId")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_id: Option<String>,
    /// Amount in the charge currency (minor units)
    #[serde(rename = "amount")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub amount: Option<f64>,
    /// Client secret used to confirm the payment on the client
    #[serde(rename = "clientSecret")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_secret: Option<String>,
    /// Creation timestamp
    #[serde(rename = "createdAt")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    /// ISO 4217 currency code
    #[serde(rename = "currency")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    /// Customer reference
    #[serde(rename = "customerRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub customer_ref: Option<String>,
    /// Exchange rate applied to the amount
    #[serde(rename = "exchangeRate")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exchange_rate: Option<f64>,
    /// Expiry timestamp of the payment intent
    #[serde(rename = "expiresAt")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    /// Original amount in the payment currency (minor units)
    #[serde(rename = "originalAmount")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_amount: Option<f64>,
    /// Plan reference
    #[serde(rename = "planRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_ref: Option<String>,
    /// Payment processor payment intent ID
    #[serde(rename = "processorPaymentId")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub processor_payment_id: Option<String>,
    /// Stripe publishable key for the environment
    #[serde(rename = "publishableKey")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub publishable_key: Option<String>,
    /// Payment intent status
    #[serde(rename = "status")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// Ledger transaction ID
    #[serde(rename = "transactionId")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transaction_id: Option<String>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SdkPlanResponse {
    /// Billing cycle
    #[serde(rename = "billingCycle")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub billing_cycle: Option<String>,
    /// Billing model
    #[serde(rename = "billingModel")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub billing_model: Option<String>,
    /// Creation timestamp
    #[serde(rename = "createdAt")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    /// Credits per usage unit (integer, >= 1)
    #[serde(rename = "creditsPerUnit")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credits_per_unit: Option<f64>,
    /// Currency code (ISO 4217)
    #[serde(rename = "currency")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    /// Currency symbol
    #[serde(rename = "currencySymbol")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency_symbol: Option<String>,
    /// Plan features
    #[serde(rename = "features")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub features: Option<BTreeMap<String, Value>>,
    /// Included free units
    #[serde(rename = "freeUnits")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub free_units: Option<f64>,
    /// Whether the plan is hidden from the customer-facing catalog. Enterprise plans (true) do not appear in checkout or the SDK catalog and can only be granted via direct assignment.
    #[serde(rename = "hidden")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
    /// Whether the plan is active
    #[serde(rename = "isActive")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_active: Option<bool>,
    /// Usage limit for the meter
    #[serde(rename = "limit")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<f64>,
    /// Usage limits
    #[serde(rename = "limits")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limits: Option<BTreeMap<String, Value>>,
    /// What the plan measures for usage tracking
    #[serde(rename = "measures")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub measures: Option<String>,
    /// Meter reference for usage-based limits
    #[serde(rename = "meterRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meter_ref: Option<String>,
    /// Plan price in cents
    #[serde(rename = "price")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub price: Option<f64>,
    /// Plan reference
    #[serde(rename = "reference")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference: Option<String>,
    /// Whether payment is required
    #[serde(rename = "requiresPayment")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requires_payment: Option<bool>,
    /// Whether unused units roll over to next period
    #[serde(rename = "rolloverUnusedUnits")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rollover_unused_units: Option<bool>,
    /// One-time setup fee
    #[serde(rename = "setupFee")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub setup_fee: Option<f64>,
    /// Plan status
    #[serde(rename = "status")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// Free trial period in days
    #[serde(rename = "trialDays")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trial_days: Option<f64>,
    /// Last update timestamp
    #[serde(rename = "updatedAt")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SdkPlanSnapshotDto {
    /// Billing cycle
    #[serde(rename = "billingCycle")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub billing_cycle: Option<String>,
    /// Credits per usage unit (integer, >= 1)
    #[serde(rename = "creditsPerUnit")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credits_per_unit: Option<f64>,
    /// Currency code
    #[serde(rename = "currency")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    /// Plan features
    #[serde(rename = "features")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub features: Option<BTreeMap<String, Value>>,
    /// Number of free units included
    #[serde(rename = "freeUnits")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub free_units: Option<f64>,
    /// Usage limit for the meter
    #[serde(rename = "limit")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<f64>,
    /// Usage limits
    #[serde(rename = "limits")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limits: Option<BTreeMap<String, Value>>,
    /// Meter reference
    #[serde(rename = "meterRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meter_ref: Option<String>,
    /// Plan name captured at purchase time
    #[serde(rename = "name")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Plan type
    #[serde(rename = "planType")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_type: Option<String>,
    /// Plan price in cents
    #[serde(rename = "price")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub price: Option<f64>,
    /// Plan reference
    #[serde(rename = "reference")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference: Option<String>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SdkPlatformConfigResponseDto {
    /// SolvaPay's platform Stripe publishable key for the authenticated provider's environment. Safe to expose browser-side; paired with the connected `accountId` returned from `create-payment-intent` for Stripe Connect direct charges. Omitted when not configured so callers can fall back cleanly to a hosted flow.
    #[serde(rename = "stripePublishableKey")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stripe_publishable_key: Option<String>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SdkProductResponse {
    /// Product balance in cents
    #[serde(rename = "balance")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub balance: Option<f64>,
    /// Product-specific configuration
    #[serde(rename = "config")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config: Option<ProductConfigDto>,
    /// Creation timestamp
    #[serde(rename = "createdAt")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    /// Product description
    #[serde(rename = "description")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// URL to the product image
    #[serde(rename = "imageUrl")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_url: Option<String>,
    /// Whether this product uses the no-code MCP integration (SolvaPay reverse proxy)
    #[serde(rename = "isMcpPay")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_mcp_pay: Option<bool>,
    /// MCP linkage details for MCP-enabled products
    #[serde(rename = "mcp")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mcp: Option<BTreeMap<String, Value>>,
    /// Arbitrary key-value metadata
    #[serde(rename = "metadata")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<BTreeMap<String, Value>>,
    /// Product name
    #[serde(rename = "name")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Plans associated with this product
    #[serde(rename = "plans")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plans: Option<Vec<SdkPlanResponse>>,
    /// Free-form product type
    #[serde(rename = "productType")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_type: Option<String>,
    /// Product reference
    #[serde(rename = "reference")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference: Option<String>,
    /// Product status
    #[serde(rename = "status")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// Total number of transactions
    #[serde(rename = "totalTransactions")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_transactions: Option<f64>,
    /// Last update timestamp
    #[serde(rename = "updatedAt")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SdkPurchaseResponse {
    /// Amount in USD cents (normalised for aggregation)
    #[serde(rename = "amount")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub amount: Option<f64>,
    /// Auto-renew enabled
    #[serde(rename = "autoRenew")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_renew: Option<bool>,
    /// Billing cycle
    #[serde(rename = "billingCycle")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub billing_cycle: Option<SdkPurchaseResponseBillingCycle>,
    /// Cancellation reason
    #[serde(rename = "cancellationReason")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cancellation_reason: Option<String>,
    /// Cancelled at
    #[serde(rename = "cancelledAt")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cancelled_at: Option<String>,
    /// Created at
    #[serde(rename = "createdAt")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    /// Original payment currency code
    #[serde(rename = "currency")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    /// Customer email
    #[serde(rename = "customerEmail")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub customer_email: Option<String>,
    /// Customer reference
    #[serde(rename = "customerRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub customer_ref: Option<String>,
    /// End date
    #[serde(rename = "endDate")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_date: Option<String>,
    /// Exchange rate from original currency to USD
    #[serde(rename = "exchangeRate")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exchange_rate: Option<f64>,
    /// Is recurring
    #[serde(rename = "isRecurring")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_recurring: Option<bool>,
    /// Arbitrary metadata attached to the purchase
    #[serde(rename = "metadata")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<BTreeMap<String, Value>>,
    /// Next billing date
    #[serde(rename = "nextBillingDate")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_billing_date: Option<String>,
    /// Original amount in the payment currency (cents/pence)
    #[serde(rename = "originalAmount")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_amount: Option<f64>,
    /// Paid at timestamp
    #[serde(rename = "paidAt")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paid_at: Option<String>,
    /// Plan snapshot at time of purchase (null for credit topups)
    #[serde(rename = "planSnapshot")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_snapshot: Option<SdkPlanSnapshotDto>,
    /// Product name
    #[serde(rename = "productName")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_name: Option<String>,
    /// Product reference
    #[serde(rename = "productRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_ref: Option<String>,
    /// Purchase reference
    #[serde(rename = "reference")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference: Option<String>,
    /// Start date
    #[serde(rename = "startDate")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_date: Option<String>,
    /// Purchase status
    #[serde(rename = "status")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// Usage billing state for usage-based plans
    #[serde(rename = "usage")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<UsageBillingDto>,
}

/// Billing cycle
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum SdkPurchaseResponseBillingCycle {
    /// Wire value `monthly`.
    #[serde(rename = "monthly")]
    Monthly,
    /// Wire value `quarterly`.
    #[serde(rename = "quarterly")]
    Quarterly,
    /// Wire value `weekly`.
    #[serde(rename = "weekly")]
    Weekly,
    /// Wire value `yearly`.
    #[serde(rename = "yearly")]
    Yearly,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UpdateCustomerRequest {
    /// Generated wire DTO.
    #[serde(rename = "description")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "email")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "externalRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_ref: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "metadata")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<BTreeMap<String, Value>>,
    /// Generated wire DTO.
    #[serde(rename = "name")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "telephone")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub telephone: Option<String>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UpdatePlanRequest {
    /// Generated wire DTO.
    #[serde(rename = "accessExpiryDays")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub access_expiry_days: Option<i64>,
    /// Generated wire DTO.
    #[serde(rename = "autoRenew")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_renew: Option<bool>,
    /// Generated wire DTO.
    #[serde(rename = "billingCycle")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub billing_cycle: Option<UpdatePlanRequestBillingCycle>,
    /// Generated wire DTO.
    #[serde(rename = "billingModel")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub billing_model: Option<UpdatePlanRequestBillingModel>,
    /// Generated wire DTO.
    #[serde(rename = "billingStrategy")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub billing_strategy: Option<UpdatePlanRequestBillingStrategy>,
    /// Generated wire DTO.
    #[serde(rename = "cancellationNoticeDays")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cancellation_notice_days: Option<i64>,
    /// Generated wire DTO.
    #[serde(rename = "creditsPerUnit")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credits_per_unit: Option<i64>,
    /// Generated wire DTO.
    #[serde(rename = "currency")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "default")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<bool>,
    /// Generated wire DTO.
    #[serde(rename = "description")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "features")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub features: Option<BTreeMap<String, Value>>,
    /// Generated wire DTO.
    #[serde(rename = "freeUnits")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub free_units: Option<i64>,
    /// Generated wire DTO.
    #[serde(rename = "fulfillment")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fulfillment: Option<UpdatePlanRequestFulfillment>,
    /// Generated wire DTO.
    #[serde(rename = "hidden")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
    /// Generated wire DTO.
    #[serde(rename = "limit")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<i64>,
    /// Generated wire DTO.
    #[serde(rename = "limits")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limits: Option<BTreeMap<String, Value>>,
    /// Generated wire DTO.
    #[serde(rename = "maxActiveUsers")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_active_users: Option<i64>,
    /// Generated wire DTO.
    #[serde(rename = "metadata")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<BTreeMap<String, Value>>,
    /// Generated wire DTO.
    #[serde(rename = "name")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "overagePolicy")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub overage_policy: Option<UpdatePlanRequestOveragePolicy>,
    /// Generated wire DTO.
    #[serde(rename = "price")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub price: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "pricingOptions")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pricing_options: Option<Vec<UpdatePlanRequestPricingOptionsItem>>,
    /// Generated wire DTO.
    #[serde(rename = "prorationPolicy")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proration_policy: Option<UpdatePlanRequestProrationPolicy>,
    /// Generated wire DTO.
    #[serde(rename = "returnPolicy")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub return_policy: Option<UpdatePlanRequestReturnPolicy>,
    /// Generated wire DTO.
    #[serde(rename = "rolloverUnusedUnits")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rollover_unused_units: Option<bool>,
    /// Generated wire DTO.
    #[serde(rename = "status")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<UpdatePlanRequestStatus>,
    /// Generated wire DTO.
    #[serde(rename = "taxBehavior")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tax_behavior: Option<UpdatePlanRequestTaxBehavior>,
    /// Generated wire DTO.
    #[serde(rename = "warranty")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warranty: Option<UpdatePlanRequestWarranty>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum UpdatePlanRequestBillingCycle {
    /// Wire value `custom`.
    #[serde(rename = "custom")]
    Custom,
    /// Wire value `monthly`.
    #[serde(rename = "monthly")]
    Monthly,
    /// Wire value `quarterly`.
    #[serde(rename = "quarterly")]
    Quarterly,
    /// Wire value `weekly`.
    #[serde(rename = "weekly")]
    Weekly,
    /// Wire value `yearly`.
    #[serde(rename = "yearly")]
    Yearly,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum UpdatePlanRequestBillingModel {
    /// Wire value `post-paid`.
    #[serde(rename = "post-paid")]
    PostPaid,
    /// Wire value `pre-paid`.
    #[serde(rename = "pre-paid")]
    PrePaid,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UpdatePlanRequestBillingStrategy {
    /// Generated wire DTO.
    #[serde(rename = "type")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub type_: Option<String>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UpdatePlanRequestFulfillment {
    /// Generated wire DTO.
    #[serde(rename = "deliveryMethod")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivery_method: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "estimatedDelivery")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub estimated_delivery: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "type")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub type_: Option<String>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UpdatePlanRequestOveragePolicy {
    /// Generated wire DTO.
    #[serde(rename = "allowOverage")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allow_overage: Option<bool>,
    /// Generated wire DTO.
    #[serde(rename = "maxOverage")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_overage: Option<f64>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UpdatePlanRequestPricingOptionsItem {
    /// Generated wire DTO.
    #[serde(rename = "basePrice")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_price: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "currency")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "default")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<bool>,
    /// Generated wire DTO.
    #[serde(rename = "price")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub price: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "setupFee")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub setup_fee: Option<f64>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UpdatePlanRequestProrationPolicy {
    /// Generated wire DTO.
    #[serde(rename = "enabled")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    /// Generated wire DTO.
    #[serde(rename = "method")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub method: Option<UpdatePlanRequestProrationPolicyMethod>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum UpdatePlanRequestProrationPolicyMethod {
    /// Wire value `full`.
    #[serde(rename = "full")]
    Full,
    /// Wire value `none`.
    #[serde(rename = "none")]
    None,
    /// Wire value `proportional`.
    #[serde(rename = "proportional")]
    Proportional,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UpdatePlanRequestReturnPolicy {
    /// Generated wire DTO.
    #[serde(rename = "allowed")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allowed: Option<bool>,
    /// Generated wire DTO.
    #[serde(rename = "conditions")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conditions: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "period")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub period: Option<f64>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum UpdatePlanRequestStatus {
    /// Wire value `active`.
    #[serde(rename = "active")]
    Active,
    /// Wire value `archived`.
    #[serde(rename = "archived")]
    Archived,
    /// Wire value `inactive`.
    #[serde(rename = "inactive")]
    Inactive,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum UpdatePlanRequestTaxBehavior {
    /// Wire value `auto`.
    #[serde(rename = "auto")]
    Auto,
    /// Wire value `exclusive`.
    #[serde(rename = "exclusive")]
    Exclusive,
    /// Wire value `inclusive`.
    #[serde(rename = "inclusive")]
    Inclusive,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UpdatePlanRequestWarranty {
    /// Generated wire DTO.
    #[serde(rename = "duration")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "terms")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terms: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "unit")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UpdateProductRequest {
    /// Generated wire DTO.
    #[serde(rename = "config")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config: Option<UpdateProductRequestConfig>,
    /// Generated wire DTO.
    #[serde(rename = "description")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "imageUrl")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_url: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "metadata")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<BTreeMap<String, Value>>,
    /// Generated wire DTO.
    #[serde(rename = "name")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "productType")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_type: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "taxBehavior")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tax_behavior: Option<UpdateProductRequestTaxBehavior>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UpdateProductRequestConfig {
    /// Generated wire DTO.
    #[serde(rename = "deliveryMethod")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivery_method: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "fulfillmentType")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fulfillment_type: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "validityPeriod")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub validity_period: Option<i64>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum UpdateProductRequestTaxBehavior {
    /// Wire value `auto`.
    #[serde(rename = "auto")]
    Auto,
    /// Wire value `exclusive`.
    #[serde(rename = "exclusive")]
    Exclusive,
    /// Wire value `inclusive`.
    #[serde(rename = "inclusive")]
    Inclusive,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UsageBillingDto {
    /// Overage cost in cents
    #[serde(rename = "overageCost")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub overage_cost: Option<f64>,
    /// Units exceeding the plan limit
    #[serde(rename = "overageUnits")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub overage_units: Option<f64>,
    /// Period end date
    #[serde(rename = "periodEnd")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub period_end: Option<String>,
    /// Period start date
    #[serde(rename = "periodStart")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub period_start: Option<String>,
    /// Units consumed in current period
    #[serde(rename = "used")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub used: Option<f64>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UsageRecordResponse {
    /// Generated wire DTO.
    #[serde(rename = "creditDebit")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credit_debit: Option<UsageRecordResponseCreditDebit>,
    /// Generated wire DTO.
    #[serde(rename = "reference")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "success")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub success: Option<bool>,
}

/// Union for `UsageRecordResponse.creditDebit`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
#[allow(clippy::large_enum_variant)]
pub enum UsageRecordResponseCreditDebit {
    /// Variant `CreditDebitSkippedResponse`.
    CreditDebitSkippedResponse(CreditDebitSkippedResponse),
    /// Variant `CreditDebitSuccessResponse`.
    CreditDebitSuccessResponse(CreditDebitSuccessResponse),
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UserInfoPlanDto {
    /// Generated wire DTO.
    #[serde(rename = "billingCycle")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub billing_cycle: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "currency")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "features")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub features: Option<Vec<String>>,
    /// Generated wire DTO.
    #[serde(rename = "limits")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limits: Option<BTreeMap<String, Value>>,
    /// Price in minor currency units (e.g. cents)
    #[serde(rename = "price")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub price: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "reference")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "type")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub type_: Option<String>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UserInfoPurchaseDto {
    /// Generated wire DTO.
    #[serde(rename = "endDate")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_date: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "plan")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan: Option<UserInfoPlanDto>,
    /// Generated wire DTO.
    #[serde(rename = "planType")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_type: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "productName")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_name: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "reference")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "startDate")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_date: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "status")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "usage")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<UserInfoUsageDto>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UserInfoRequest {
    /// Generated wire DTO.
    #[serde(rename = "customerRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub customer_ref: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "productRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_ref: Option<String>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UserInfoResponse {
    /// Generated wire DTO.
    #[serde(rename = "purchase")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub purchase: Option<UserInfoPurchaseDto>,
    /// Human-readable status summary
    #[serde(rename = "status")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "user")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user: Option<UserInfoUserDto>,
    /// Customer portal session URL
    #[serde(rename = "verifyUrl")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verify_url: Option<String>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UserInfoUsageDto {
    /// Meter reference
    #[serde(rename = "meterRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meter_ref: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "percentUsed")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub percent_used: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "remaining")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remaining: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "total")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total: Option<f64>,
    /// Generated wire DTO.
    #[serde(rename = "used")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub used: Option<f64>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UserInfoUserDto {
    /// Generated wire DTO.
    #[serde(rename = "email")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "externalRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_ref: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "name")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "reference")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference: Option<String>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WebhookEventCategoryDto {
    /// Category key.
    #[serde(rename = "category")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    /// Category description.
    #[serde(rename = "description")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Events in this category.
    #[serde(rename = "events")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub events: Option<Vec<WebhookEventDefinitionDto>>,
    /// Human-readable category label.
    #[serde(rename = "label")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WebhookEventDataDto {
    /// The resource that the event relates to.
    #[serde(rename = "object")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub object: Option<BTreeMap<String, Value>>,
    /// For *.updated events, the previous values of changed attributes.
    #[serde(rename = "previous_attributes")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_attributes: Option<BTreeMap<String, Value>>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WebhookEventDefinitionDto {
    /// Human-readable description of the event.
    #[serde(rename = "description")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Emission status.
    #[serde(rename = "status")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<WebhookEventDefinitionDtoStatus>,
    /// Generated wire DTO.
    #[serde(rename = "type")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub type_: Option<WebhookEventType>,
}

/// Emission status.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum WebhookEventDefinitionDtoStatus {
    /// Wire value `live`.
    #[serde(rename = "live")]
    Live,
    /// Wire value `planned`.
    #[serde(rename = "planned")]
    Planned,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WebhookEventDto {
    /// API version that produced the event payload.
    #[serde(rename = "api_version")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_version: Option<String>,
    /// Unix timestamp (seconds) when the event was created.
    #[serde(rename = "created")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created: Option<f64>,
    /// Event payload envelope.
    #[serde(rename = "data")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<WebhookEventDataDto>,
    /// Unique event ID.
    #[serde(rename = "id")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// True for live-mode events, false for sandbox.
    #[serde(rename = "livemode")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub livemode: Option<bool>,
    /// Context about the triggering API request.
    #[serde(rename = "request")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request: Option<WebhookEventRequestDto>,
    /// Generated wire DTO.
    #[serde(rename = "type")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub type_: Option<WebhookEventType>,
}

/// Generated wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WebhookEventRequestDto {
    /// ID of the API request that triggered the event.
    #[serde(rename = "id")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<BTreeMap<String, Value>>,
    /// Idempotency key of the triggering request.
    #[serde(rename = "idempotency_key")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub idempotency_key: Option<BTreeMap<String, Value>>,
}

/// Event type.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum WebhookEventType {
    /// Wire value `checkout_session.completed`.
    #[serde(rename = "checkout_session.completed")]
    CheckoutSessionCompleted,
    /// Wire value `checkout_session.created`.
    #[serde(rename = "checkout_session.created")]
    CheckoutSessionCreated,
    /// Wire value `checkout_session.expired`.
    #[serde(rename = "checkout_session.expired")]
    CheckoutSessionExpired,
    /// Wire value `customer.created`.
    #[serde(rename = "customer.created")]
    CustomerCreated,
    /// Wire value `customer.credit.adjusted`.
    #[serde(rename = "customer.credit.adjusted")]
    CustomerCreditAdjusted,
    /// Wire value `customer.credit.auto_topup_failed`.
    #[serde(rename = "customer.credit.auto_topup_failed")]
    CustomerCreditAutoTopupFailed,
    /// Wire value `customer.credit.debited`.
    #[serde(rename = "customer.credit.debited")]
    CustomerCreditDebited,
    /// Wire value `customer.credit.exhausted`.
    #[serde(rename = "customer.credit.exhausted")]
    CustomerCreditExhausted,
    /// Wire value `customer.credit.granted`.
    #[serde(rename = "customer.credit.granted")]
    CustomerCreditGranted,
    /// Wire value `customer.credit.low_balance`.
    #[serde(rename = "customer.credit.low_balance")]
    CustomerCreditLowBalance,
    /// Wire value `customer.credit.topped_up`.
    #[serde(rename = "customer.credit.topped_up")]
    CustomerCreditToppedUp,
    /// Wire value `customer.deleted`.
    #[serde(rename = "customer.deleted")]
    CustomerDeleted,
    /// Wire value `customer.updated`.
    #[serde(rename = "customer.updated")]
    CustomerUpdated,
    /// Wire value `payment.canceled`.
    #[serde(rename = "payment.canceled")]
    PaymentCanceled,
    /// Wire value `payment.dispute_closed`.
    #[serde(rename = "payment.dispute_closed")]
    PaymentDisputeClosed,
    /// Wire value `payment.disputed`.
    #[serde(rename = "payment.disputed")]
    PaymentDisputed,
    /// Wire value `payment.failed`.
    #[serde(rename = "payment.failed")]
    PaymentFailed,
    /// Wire value `payment.refund_failed`.
    #[serde(rename = "payment.refund_failed")]
    PaymentRefundFailed,
    /// Wire value `payment.refund_pending`.
    #[serde(rename = "payment.refund_pending")]
    PaymentRefundPending,
    /// Wire value `payment.refunded`.
    #[serde(rename = "payment.refunded")]
    PaymentRefunded,
    /// Wire value `payment.succeeded`.
    #[serde(rename = "payment.succeeded")]
    PaymentSucceeded,
    /// Wire value `payout.failed`.
    #[serde(rename = "payout.failed")]
    PayoutFailed,
    /// Wire value `payout.paid`.
    #[serde(rename = "payout.paid")]
    PayoutPaid,
    /// Wire value `plan.archived`.
    #[serde(rename = "plan.archived")]
    PlanArchived,
    /// Wire value `plan.created`.
    #[serde(rename = "plan.created")]
    PlanCreated,
    /// Wire value `plan.updated`.
    #[serde(rename = "plan.updated")]
    PlanUpdated,
    /// Wire value `product.archived`.
    #[serde(rename = "product.archived")]
    ProductArchived,
    /// Wire value `product.created`.
    #[serde(rename = "product.created")]
    ProductCreated,
    /// Wire value `product.updated`.
    #[serde(rename = "product.updated")]
    ProductUpdated,
    /// Wire value `purchase.activated`.
    #[serde(rename = "purchase.activated")]
    PurchaseActivated,
    /// Wire value `purchase.cancellation_scheduled`.
    #[serde(rename = "purchase.cancellation_scheduled")]
    PurchaseCancellationScheduled,
    /// Wire value `purchase.cancelled`.
    #[serde(rename = "purchase.cancelled")]
    PurchaseCancelled,
    /// Wire value `purchase.created`.
    #[serde(rename = "purchase.created")]
    PurchaseCreated,
    /// Wire value `purchase.expired`.
    #[serde(rename = "purchase.expired")]
    PurchaseExpired,
    /// Wire value `purchase.past_due`.
    #[serde(rename = "purchase.past_due")]
    PurchasePastDue,
    /// Wire value `purchase.plan_changed`.
    #[serde(rename = "purchase.plan_changed")]
    PurchasePlanChanged,
    /// Wire value `purchase.reactivated`.
    #[serde(rename = "purchase.reactivated")]
    PurchaseReactivated,
    /// Wire value `purchase.refunded`.
    #[serde(rename = "purchase.refunded")]
    PurchaseRefunded,
    /// Wire value `purchase.renewal_reminder`.
    #[serde(rename = "purchase.renewal_reminder")]
    PurchaseRenewalReminder,
    /// Wire value `purchase.renewed`.
    #[serde(rename = "purchase.renewed")]
    PurchaseRenewed,
    /// Wire value `purchase.suspended`.
    #[serde(rename = "purchase.suspended")]
    PurchaseSuspended,
    /// Wire value `purchase.trial_converted`.
    #[serde(rename = "purchase.trial_converted")]
    PurchaseTrialConverted,
    /// Wire value `purchase.trial_ending`.
    #[serde(rename = "purchase.trial_ending")]
    PurchaseTrialEnding,
    /// Wire value `purchase.updated`.
    #[serde(rename = "purchase.updated")]
    PurchaseUpdated,
    /// Wire value `usage.charged`.
    #[serde(rename = "usage.charged")]
    UsageCharged,
    /// Wire value `usage.recorded`.
    #[serde(rename = "usage.recorded")]
    UsageRecorded,
    /// Wire value `usage.reset`.
    #[serde(rename = "usage.reset")]
    UsageReset,
}
