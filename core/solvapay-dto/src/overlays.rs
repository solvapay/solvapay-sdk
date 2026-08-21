// @generated — do not edit. Regenerate with: pnpm gen

//! SDK-only overlay types from `contract/manifest/sdk-contract.yaml`.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::schemas;

/// Enum for `AutoRechargeConfig.fundingSourceType`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AutoRechargeConfigFundingSourceType {
    /// Wire value `saved_card`.
    #[serde(rename = "saved_card")]
    SavedCard,
    /// Wire value `tokenized_card`.
    #[serde(rename = "tokenized_card")]
    TokenizedCard,
}

/// Enum for `AutoRechargeDisplayBlock.rateSource`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AutoRechargeDisplayBlockRateSource {
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

/// Enum for `CreditDisplayBlock.rateSource`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum CreditDisplayBlockRateSource {
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

/// Enum for `RetryOptions.backoffStrategy`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum RetryOptionsBackoffStrategy {
    /// Wire value `exponential`.
    #[serde(rename = "exponential")]
    Exponential,
    /// Wire value `fixed`.
    #[serde(rename = "fixed")]
    Fixed,
    /// Wire value `linear`.
    #[serde(rename = "linear")]
    Linear,
}

/// Inline object for `SolvaPayError.init`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SolvaPayErrorInit {
    /// Generated wire DTO.
    #[serde(rename = "code")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "status")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<f64>,
}

/// Enum for `TaxBreakdown.treatment`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum TaxBreakdownTreatment {
    /// Wire value `none`.
    #[serde(rename = "none")]
    None,
    /// Wire value `not_collecting`.
    #[serde(rename = "not_collecting")]
    NotCollecting,
    /// Wire value `reverse_charge`.
    #[serde(rename = "reverse_charge")]
    ReverseCharge,
    /// Wire value `standard`.
    #[serde(rename = "standard")]
    Standard,
}

/// Projected succeeded arm.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TopupProcessResultSucceeded {
    /// Status discriminator.
    #[serde(rename = "status")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "creditsAdded")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credits_added: Option<f64>,
}

/// Inline object for `verifyWebhook.options`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VerifyWebhookOptions {
    /// Generated wire DTO.
    #[serde(rename = "body")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "secret")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secret: Option<String>,
    /// Generated wire DTO.
    #[serde(rename = "signature")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
}

/// SDK overlay extending `GrantCustomerCreditsRequest`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AssignCreditsRequest {
    /// Flattened base DTO fields.
    #[serde(flatten)]
    pub base: schemas::GrantCustomerCreditsRequest,
    /// Overlay field.
    #[serde(rename = "customerRef")]
    pub customer_ref: String,
    /// Overlay field.
    #[serde(rename = "idempotencyKey")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub idempotency_key: Option<String>,
}

/// SDK-only type `AttachBusinessDetailsParams`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AttachBusinessDetailsParams {
    /// Overlay field.
    #[serde(rename = "businessName")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub business_name: Option<String>,
    /// Overlay field.
    #[serde(rename = "country")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub country: Option<String>,
    /// Overlay field.
    #[serde(rename = "customerCountry")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub customer_country: Option<String>,
    /// Overlay field.
    #[serde(rename = "customerName")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub customer_name: Option<String>,
    /// Overlay field.
    #[serde(rename = "customerRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub customer_ref: Option<String>,
    /// Overlay field.
    #[serde(rename = "isBusiness")]
    pub is_business: bool,
    /// Overlay field.
    #[serde(rename = "paymentIntentId")]
    pub payment_intent_id: String,
    /// Overlay field.
    #[serde(rename = "taxId")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tax_id: Option<String>,
    /// Overlay field.
    #[serde(rename = "taxIdType")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tax_id_type: Option<String>,
}

/// SDK-only type `AutoMappedTool`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AutoMappedTool {
    /// Overlay field.
    #[serde(rename = "description")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Overlay field.
    #[serde(rename = "name")]
    pub name: String,
}

/// SDK-only type `AutoRechargeDisplayFormatted`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AutoRechargeDisplayFormatted {
    /// Overlay field.
    #[serde(rename = "threshold")]
    pub threshold: String,
    /// Overlay field.
    #[serde(rename = "topup")]
    pub topup: String,
}

/// SDK-only type `AutoRechargeInput`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AutoRechargeInput {
    /// Overlay field.
    #[serde(rename = "currency")]
    pub currency: String,
    /// Overlay field.
    #[serde(rename = "enabled")]
    pub enabled: bool,
    /// Overlay field.
    #[serde(rename = "maxMonthlySpendMajor")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_monthly_spend_major: Option<f64>,
    /// Overlay field.
    #[serde(rename = "thresholdAmountMajor")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub threshold_amount_major: Option<f64>,
    /// Overlay field.
    #[serde(rename = "topupAmountMajor")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub topup_amount_major: Option<f64>,
    /// Overlay field.
    #[serde(rename = "triggerType")]
    pub trigger_type: String,
}

/// SDK enum `AutoRechargeStatus`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AutoRechargeStatus {
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

/// SDK-only type `AutoRechargeTopup`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AutoRechargeTopup {
    /// Overlay field.
    #[serde(rename = "amountMinor")]
    pub amount_minor: f64,
    /// Overlay field.
    #[serde(rename = "currency")]
    pub currency: String,
    /// Overlay field.
    #[serde(rename = "mode")]
    pub mode: String,
}

/// SDK-only type `AutoRechargeTrigger`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AutoRechargeTrigger {
    /// Overlay field.
    #[serde(rename = "thresholdAmountMinor")]
    pub threshold_amount_minor: f64,
    /// Overlay field.
    #[serde(rename = "type")]
    pub type_: String,
}

/// SDK-only type `CancelPurchaseParams`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CancelPurchaseParams {
    /// Overlay field.
    #[serde(rename = "purchaseRef")]
    pub purchase_ref: String,
    /// Overlay field.
    #[serde(rename = "reason")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// SDK overlay extending `CheckLimitRequest`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CheckLimitsRequest {
    /// Flattened base DTO fields.
    #[serde(flatten)]
    pub base: schemas::CheckLimitRequest,
    /// When true, the backend mints a checkout session (or customer portal session for activation flows) and returns its URL / id on the response.
    #[serde(rename = "includeCheckoutSession")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub include_checkout_session: Option<bool>,
}

/// SDK-only type `CloneProductOverrides`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CloneProductOverrides {
    /// Overlay field.
    #[serde(rename = "name")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// SDK-only type `CloneProductResult`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CloneProductResult {
    /// Overlay field.
    #[serde(rename = "name")]
    pub name: String,
    /// Overlay field.
    #[serde(rename = "reference")]
    pub reference: String,
}

/// SDK-only type `CreateCustomerResult`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreateCustomerResult {
    /// Overlay field.
    #[serde(rename = "customerRef")]
    pub customer_ref: String,
}

/// SDK-only type `CreatePaymentIntentParams`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreatePaymentIntentParams {
    /// Overlay field.
    #[serde(rename = "currency")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    /// Overlay field.
    #[serde(rename = "customerRef")]
    pub customer_ref: String,
    /// Overlay field.
    #[serde(rename = "idempotencyKey")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub idempotency_key: Option<String>,
    /// Overlay field.
    #[serde(rename = "planRef")]
    pub plan_ref: String,
    /// Overlay field.
    #[serde(rename = "productRef")]
    pub product_ref: String,
}

/// SDK-only type `CreatePaymentIntentResult`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreatePaymentIntentResult {
    /// Overlay field.
    #[serde(rename = "accountId")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_id: Option<String>,
    /// Overlay field.
    #[serde(rename = "amount")]
    pub amount: f64,
    /// Overlay field.
    #[serde(rename = "clientSecret")]
    pub client_secret: String,
    /// Overlay field.
    #[serde(rename = "currency")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    /// Overlay field.
    #[serde(rename = "exchangeRate")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exchange_rate: Option<f64>,
    /// Overlay field.
    #[serde(rename = "originalAmount")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_amount: Option<f64>,
    /// Overlay field.
    #[serde(rename = "processorPaymentId")]
    pub processor_payment_id: String,
    /// Overlay field.
    #[serde(rename = "publishableKey")]
    pub publishable_key: String,
    /// Overlay field.
    #[serde(rename = "status")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

/// SDK overlay extending `CreatePlanRequest`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreatePlanParams {
    /// Flattened base DTO fields.
    #[serde(flatten)]
    pub base: schemas::CreatePlanRequest,
    /// Overlay field.
    #[serde(rename = "productRef")]
    pub product_ref: String,
}

/// SDK-only type `CreateProductResult`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreateProductResult {
    /// Overlay field.
    #[serde(rename = "name")]
    pub name: String,
    /// Overlay field.
    #[serde(rename = "reference")]
    pub reference: String,
}

/// SDK-only type `CreateTopupPaymentIntentParams`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreateTopupPaymentIntentParams {
    /// Overlay field.
    #[serde(rename = "amount")]
    pub amount: f64,
    /// Overlay field.
    #[serde(rename = "autoRecharge")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_recharge: Option<AutoRechargeInput>,
    /// Overlay field.
    #[serde(rename = "currency")]
    pub currency: String,
    /// Overlay field.
    #[serde(rename = "customerRef")]
    pub customer_ref: String,
    /// Overlay field.
    #[serde(rename = "description")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Overlay field.
    #[serde(rename = "idempotencyKey")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub idempotency_key: Option<String>,
}

/// SDK-only type `CreateTopupPaymentIntentResult`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreateTopupPaymentIntentResult {
    /// Overlay field.
    #[serde(rename = "accountId")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_id: Option<String>,
    /// Overlay field.
    #[serde(rename = "clientSecret")]
    pub client_secret: String,
    /// Overlay field.
    #[serde(rename = "processorPaymentId")]
    pub processor_payment_id: String,
    /// Overlay field.
    #[serde(rename = "publishableKey")]
    pub publishable_key: String,
}

/// SDK-only type `DisableAutoRechargeParams`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DisableAutoRechargeParams {
    /// Overlay field.
    #[serde(rename = "customerRef")]
    pub customer_ref: String,
}

/// SDK overlay extending `PurchaseInfo`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EnrichedPurchaseInfo {
    /// Flattened base DTO fields.
    #[serde(flatten)]
    pub base: schemas::PurchaseInfo,
    /// Overlay field.
    #[serde(rename = "nextBillingDate")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_billing_date: Option<String>,
    /// Overlay field.
    #[serde(rename = "paidAt")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paid_at: Option<String>,
}

/// SDK-only type `GetAutoRechargeParams`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GetAutoRechargeParams {
    /// Overlay field.
    #[serde(rename = "customerRef")]
    pub customer_ref: String,
}

/// SDK-only type `GetCustomerBalanceParams`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GetCustomerBalanceParams {
    /// Overlay field.
    #[serde(rename = "customerRef")]
    pub customer_ref: String,
}

/// SDK-only type `GetCustomerParams`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GetCustomerParams {
    /// Overlay field.
    #[serde(rename = "customerRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub customer_ref: Option<String>,
    /// Overlay field.
    #[serde(rename = "email")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    /// Overlay field.
    #[serde(rename = "externalRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_ref: Option<String>,
}

/// SDK-only type `GetPaymentMethodParams`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GetPaymentMethodParams {
    /// Overlay field.
    #[serde(rename = "customerRef")]
    pub customer_ref: String,
}

/// SDK-only type `GetUserInfoParams`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GetUserInfoParams {
    /// Overlay field.
    #[serde(rename = "customerRef")]
    pub customer_ref: String,
    /// Overlay field.
    #[serde(rename = "productRef")]
    pub product_ref: String,
}

/// SDK overlay extending `LimitResponse`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LimitResponseWithPlan {
    /// Flattened base DTO fields.
    #[serde(flatten)]
    pub base: schemas::LimitResponse,
    /// Overlay field.
    #[serde(rename = "plan")]
    pub plan: String,
}

/// List of `Plan`.
pub type ListPlansResult = Vec<schemas::Plan>;

/// SDK-only type `ListProductItem`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ListProductItem {
    /// Overlay field.
    #[serde(rename = "description")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Overlay field.
    #[serde(rename = "name")]
    pub name: String,
    /// Overlay field.
    #[serde(rename = "reference")]
    pub reference: String,
}

/// List of `ListProductItem`.
pub type ListProductsResult = Vec<ListProductItem>;

/// SDK-only type `McpServerInfo`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct McpServerInfo {
    /// Overlay field.
    #[serde(rename = "defaultPlanRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_plan_ref: Option<String>,
    /// Overlay field.
    #[serde(rename = "mcpProxyUrl")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mcp_proxy_url: Option<String>,
    /// Overlay field.
    #[serde(rename = "reference")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference: Option<String>,
    /// Overlay field.
    #[serde(rename = "subdomain")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subdomain: Option<String>,
    /// Overlay field.
    #[serde(rename = "url")]
    pub url: String,
}

/// SDK-only type `OneTimePurchaseInfo`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OneTimePurchaseInfo {
    /// Overlay field.
    #[serde(rename = "amount")]
    pub amount: f64,
    /// Overlay field.
    #[serde(rename = "completedAt")]
    pub completed_at: String,
    /// Overlay field.
    #[serde(rename = "creditsAdded")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credits_added: Option<f64>,
    /// Overlay field.
    #[serde(rename = "currency")]
    pub currency: String,
    /// Overlay field.
    #[serde(rename = "productRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_ref: Option<String>,
    /// Overlay field.
    #[serde(rename = "reference")]
    pub reference: String,
}

/// Alias of `PaymentMethodResult`.
pub type PaymentMethodInfo = schemas::PaymentMethodResult;

/// SDK-only type `PlanMapEntry`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlanMapEntry {
    /// Overlay field.
    #[serde(rename = "name")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Overlay field.
    #[serde(rename = "reference")]
    pub reference: String,
}

/// SDK-only type `ProcessPaymentIntentParams`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProcessPaymentIntentParams {
    /// Overlay field.
    #[serde(rename = "customerRef")]
    pub customer_ref: String,
    /// Overlay field.
    #[serde(rename = "paymentIntentId")]
    pub payment_intent_id: String,
    /// Overlay field.
    #[serde(rename = "planRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_ref: Option<String>,
    /// Overlay field.
    #[serde(rename = "productRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_ref: Option<String>,
}

/// SDK-only type `ReactivatePurchaseParams`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReactivatePurchaseParams {
    /// Overlay field.
    #[serde(rename = "purchaseRef")]
    pub purchase_ref: String,
}

/// SDK overlay extending `AutoRechargeInput`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SaveAutoRechargeInput {
    /// Flattened base DTO fields.
    #[serde(flatten)]
    pub base: AutoRechargeInput,
    /// Overlay field.
    #[serde(rename = "deferSetupIntent")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub defer_setup_intent: Option<bool>,
}

/// SDK overlay extending `SaveAutoRechargeInput`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SaveAutoRechargeParams {
    /// Flattened base DTO fields.
    #[serde(flatten)]
    pub base: SaveAutoRechargeInput,
    /// Overlay field.
    #[serde(rename = "customerRef")]
    pub customer_ref: String,
}

/// SDK overlay extending `CreateUsageRequest`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TrackUsageRequest {
    /// Flattened base DTO fields.
    #[serde(flatten)]
    pub base: schemas::CreateUsageRequest,
    /// Overlay field.
    #[serde(rename = "customerRef")]
    pub customer_ref: String,
    /// Overlay field.
    #[serde(rename = "metadata")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<BTreeMap<String, Value>>,
}

/// SDK-only type `UpdateCustomerParams`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UpdateCustomerParams {
    /// Overlay field.
    #[serde(rename = "email")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    /// Overlay field.
    #[serde(rename = "externalRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_ref: Option<String>,
    /// Overlay field.
    #[serde(rename = "metadata")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<BTreeMap<String, Value>>,
    /// Overlay field.
    #[serde(rename = "name")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Overlay field.
    #[serde(rename = "telephone")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub telephone: Option<String>,
}

/// SDK-only type `UpdateCustomerResult`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UpdateCustomerResult {
    /// Overlay field.
    #[serde(rename = "customerRef")]
    pub customer_ref: String,
}

/// Void / unit sentinel.
pub type Void = ();

/// SDK-only type `ConfigureMcpPlansResponse`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConfigureMcpPlansResponse {
    /// Overlay field.
    #[serde(rename = "mcpServer")]
    pub mcp_server: McpServerInfo,
    /// Overlay field.
    #[serde(rename = "planMap")]
    pub plan_map: BTreeMap<String, PlanMapEntry>,
    /// Overlay field.
    #[serde(rename = "product")]
    pub product: schemas::SdkProductResponse,
}

/// SDK mapped response overlay.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CustomerResponseMapped {
    /// Mapped from wire `reference`.
    #[serde(rename = "customerRef")]
    pub customer_ref: String,
    /// Overlay field.
    #[serde(rename = "email")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    /// Overlay field.
    #[serde(rename = "externalRef")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_ref: Option<String>,
    /// Overlay field.
    #[serde(rename = "name")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Overlay field.
    #[serde(rename = "plan")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan: Option<String>,
    /// Overlay field.
    #[serde(rename = "purchases")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub purchases: Option<Vec<EnrichedPurchaseInfo>>,
}

/// SDK-only type `McpBootstrapResponse`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct McpBootstrapResponse {
    /// Overlay field.
    #[serde(rename = "autoMappedTools")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_mapped_tools: Option<Vec<AutoMappedTool>>,
    /// Overlay field.
    #[serde(rename = "mcpServer")]
    pub mcp_server: McpServerInfo,
    /// Overlay field.
    #[serde(rename = "planMap")]
    pub plan_map: BTreeMap<String, PlanMapEntry>,
    /// Overlay field.
    #[serde(rename = "product")]
    pub product: schemas::SdkProductResponse,
    /// Overlay field.
    #[serde(rename = "toolsAutoMapped")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tools_auto_mapped: Option<bool>,
}

/// SDK-only type `TrackUsageBulkRequest`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TrackUsageBulkRequest {
    /// Overlay field.
    #[serde(rename = "events")]
    pub events: Vec<TrackUsageRequest>,
}

/// SDK-only type `AttachBusinessDetailsResult`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AttachBusinessDetailsResult {
    /// Overlay field.
    #[serde(rename = "taxBreakdown")]
    pub tax_breakdown: TaxBreakdown,
}

/// SDK-only type `AutoRechargeConfig`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AutoRechargeConfig {
    /// Backend-computed display values — render verbatim; do not derive from trigger fields.
    #[serde(rename = "display")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display: Option<AutoRechargeDisplayBlock>,
    /// Overlay field.
    #[serde(rename = "enabled")]
    pub enabled: bool,
    /// Overlay field.
    #[serde(rename = "failureCount")]
    pub failure_count: f64,
    /// Overlay field.
    #[serde(rename = "fundingSourceType")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub funding_source_type: Option<AutoRechargeConfigFundingSourceType>,
    /// Overlay field.
    #[serde(rename = "lastChargeAt")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_charge_at: Option<String>,
    /// Overlay field.
    #[serde(rename = "maxMonthlySpendMinor")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_monthly_spend_minor: Option<f64>,
    /// Overlay field.
    #[serde(rename = "monthlySpendMinor")]
    pub monthly_spend_minor: f64,
    /// Overlay field.
    #[serde(rename = "monthlySpendPeriod")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub monthly_spend_period: Option<String>,
    /// Overlay field.
    #[serde(rename = "paymentMethodId")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payment_method_id: Option<String>,
    /// Overlay field.
    #[serde(rename = "status")]
    pub status: AutoRechargeStatus,
    /// Overlay field.
    #[serde(rename = "topup")]
    pub topup: AutoRechargeTopup,
    /// Overlay field.
    #[serde(rename = "trigger")]
    pub trigger: AutoRechargeTrigger,
    /// Overlay field.
    #[serde(rename = "updatedAt")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

/// SDK-only type `AutoRechargeDisplayBlock`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AutoRechargeDisplayBlock {
    /// Overlay field.
    #[serde(rename = "currency")]
    pub currency: String,
    /// Overlay field.
    #[serde(rename = "exchangeRate")]
    pub exchange_rate: f64,
    /// Overlay field.
    #[serde(rename = "formatted")]
    pub formatted: AutoRechargeDisplayFormatted,
    /// Overlay field.
    #[serde(rename = "rateSource")]
    pub rate_source: AutoRechargeDisplayBlockRateSource,
    /// Overlay field.
    #[serde(rename = "thresholdAmountMajor")]
    pub threshold_amount_major: f64,
    /// Overlay field.
    #[serde(rename = "topupAmountMajor")]
    pub topup_amount_major: f64,
}

/// SDK-only type `AutoRechargeResponse`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AutoRechargeResponse {
    /// Overlay field.
    #[serde(rename = "config")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config: Option<AutoRechargeConfig>,
    /// Overlay field.
    #[serde(rename = "display")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display: Option<AutoRechargeDisplayBlock>,
}

/// SDK-only type `CreditDisplayBlock`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreditDisplayBlock {
    /// Overlay field.
    #[serde(rename = "amountMajor")]
    pub amount_major: f64,
    /// Overlay field.
    #[serde(rename = "currency")]
    pub currency: String,
    /// Overlay field.
    #[serde(rename = "exchangeRate")]
    pub exchange_rate: f64,
    /// Overlay field.
    #[serde(rename = "formatted")]
    pub formatted: String,
    /// Overlay field.
    #[serde(rename = "rateSource")]
    pub rate_source: CreditDisplayBlockRateSource,
}

/// SDK-only type `GetCustomerBalanceResult`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GetCustomerBalanceResult {
    /// Overlay field.
    #[serde(rename = "credits")]
    pub credits: f64,
    /// Overlay field.
    #[serde(rename = "creditsPerMinorUnit")]
    pub credits_per_minor_unit: f64,
    /// Overlay field.
    #[serde(rename = "customerRef")]
    pub customer_ref: String,
    /// Overlay field.
    #[serde(rename = "display")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display: Option<CreditDisplayBlock>,
    /// Overlay field.
    #[serde(rename = "displayCurrency")]
    pub display_currency: String,
    /// Overlay field.
    #[serde(rename = "displayExchangeRate")]
    pub display_exchange_rate: f64,
}

/// SDK-only type `RetryOptions`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RetryOptions {
    /// Overlay field.
    #[serde(rename = "backoffStrategy")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backoff_strategy: Option<RetryOptionsBackoffStrategy>,
    /// Overlay field.
    #[serde(rename = "initialDelay")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub initial_delay: Option<f64>,
    /// Overlay field.
    #[serde(rename = "maxRetries")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_retries: Option<f64>,
    /// Overlay field.
    #[serde(rename = "onRetry")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_retry: Option<Value>,
    /// Overlay field.
    #[serde(rename = "shouldRetry")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub should_retry: Option<Value>,
}

/// SDK-only type `TaxBreakdown`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TaxBreakdown {
    /// Overlay field.
    #[serde(rename = "currency")]
    pub currency: String,
    /// Overlay field.
    #[serde(rename = "inclusive")]
    pub inclusive: bool,
    /// Overlay field.
    #[serde(rename = "subtotal")]
    pub subtotal: f64,
    /// Overlay field.
    #[serde(rename = "taxAmount")]
    pub tax_amount: f64,
    /// Overlay field.
    #[serde(rename = "taxRate")]
    pub tax_rate: f64,
    /// Overlay field.
    #[serde(rename = "total")]
    pub total: f64,
    /// Overlay field.
    #[serde(rename = "treatment")]
    pub treatment: TaxBreakdownTreatment,
}

/// Projected union overlay.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
#[allow(clippy::large_enum_variant)]
pub enum TopupProcessResult {
    /// Variant `Processing`.
    Processing(schemas::ProcessPaymentProcessing),
    /// Variant `Timeout`.
    Timeout(schemas::ProcessPaymentTimeout),
    /// Variant `Failed`.
    Failed(schemas::ProcessPaymentFailed),
    /// Variant `Cancelled`.
    Cancelled(schemas::ProcessPaymentCancelled),
    /// Variant `Succeeded`.
    Succeeded(TopupProcessResultSucceeded),
}
