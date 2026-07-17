/**
* @generated — do not edit. Regenerate with:
*   cargo run -p dto-gen -- \
*     --snapshot ../contract/openapi/sdk-v1.snapshot.json \
*     --manifest ../contract/manifest/sdk-contract.yaml \
*     --out crates/solvapay-dto/src \
*     --ts-out packages/server/src/types/overlays.generated.d.ts
*/

import type { components, operations } from './generated'

/**
 * Enum for `AutoRechargeConfig.fundingSourceType`.
 */
export type AutoRechargeConfigFundingSourceType = 'saved_card' | 'tokenized_card'

/**
 * Enum for `AutoRechargeDisplayBlock.rateSource`.
 */
export type AutoRechargeDisplayBlockRateSource = 'db' | 'fallback' | 'parity'

/**
 * Enum for `CreditDisplayBlock.rateSource`.
 */
export type CreditDisplayBlockRateSource = 'db' | 'fallback' | 'parity'

/**
 * Enum for `RetryOptions.backoffStrategy`.
 */
export type RetryOptionsBackoffStrategy = 'exponential' | 'fixed' | 'linear'

/**
 * Inline object for `SolvaPayError.init`.
 */
export type SolvaPayErrorInit = {
  code?: string
  status?: number
}

/**
 * Enum for `TaxBreakdown.treatment`.
 */
export type TaxBreakdownTreatment = 'none' | 'not_collecting' | 'reverse_charge' | 'standard'

/**
 * Projected succeeded arm.
 */
export type TopupProcessResultSucceeded = {
/**
 * Status discriminator.
 */
  status: string
  creditsAdded?: number
}

/**
 * Inline object for `verifyWebhook.options`.
 */
export type VerifyWebhookOptions = {
  body: string
  secret: string
  signature: string
}

/**
 * SDK overlay extending `GrantCustomerCreditsRequest`.
 */
export type AssignCreditsRequest = components['schemas']['GrantCustomerCreditsRequest'] & {
  customerRef: string
  idempotencyKey?: string
}

/**
 * SDK-only type `AttachBusinessDetailsParams`.
 */
export type AttachBusinessDetailsParams = {
  businessName?: string
  country?: string
  customerCountry?: string
  customerName?: string
  customerRef?: string
  isBusiness: boolean
  paymentIntentId: string
  taxId?: string
  taxIdType?: string
}

/**
 * SDK-only type `AttachBusinessDetailsResult`.
 */
export type AttachBusinessDetailsResult = {
  taxBreakdown: TaxBreakdown
}

/**
 * SDK-only type `AutoMappedTool`.
 */
export type AutoMappedTool = {
  description?: string
  name: string
}

/**
 * SDK-only type `AutoRechargeConfig`.
 */
export type AutoRechargeConfig = {
/**
 * Backend-computed display values — render verbatim; do not derive from trigger fields.
 */
  display?: AutoRechargeDisplayBlock
  enabled: boolean
  failureCount: number
  fundingSourceType?: AutoRechargeConfigFundingSourceType
  lastChargeAt?: string
  maxMonthlySpendMinor?: number
  monthlySpendMinor: number
  monthlySpendPeriod?: string
  paymentMethodId?: string
  status: AutoRechargeStatus
  topup: AutoRechargeTopup
  trigger: AutoRechargeTrigger
  updatedAt?: string
}

/**
 * SDK-only type `AutoRechargeDisplayBlock`.
 */
export type AutoRechargeDisplayBlock = {
  currency: string
  exchangeRate: number
  formatted: AutoRechargeDisplayFormatted
  rateSource: AutoRechargeDisplayBlockRateSource
  thresholdAmountMajor: number
  topupAmountMajor: number
}

/**
 * SDK-only type `AutoRechargeDisplayFormatted`.
 */
export type AutoRechargeDisplayFormatted = {
  threshold: string
  topup: string
}

/**
 * SDK-only type `AutoRechargeInput`.
 */
export type AutoRechargeInput = {
  currency: string
  enabled: boolean
  maxMonthlySpendMajor?: number
  thresholdAmountMajor?: number
  topupAmountMajor?: number
  triggerType: 'balance'
}

/**
 * SDK-only type `AutoRechargeResponse`.
 */
export type AutoRechargeResponse = {
  config: AutoRechargeConfig | null
  display?: AutoRechargeDisplayBlock
}

/**
 * SDK enum `AutoRechargeStatus`.
 */
export type AutoRechargeStatus = 'active' | 'disabled' | 'failed' | 'pending_setup'

/**
 * SDK-only type `AutoRechargeTopup`.
 */
export type AutoRechargeTopup = {
  amountMinor: number
  currency: string
  mode: 'fixed'
}

/**
 * SDK-only type `AutoRechargeTrigger`.
 */
export type AutoRechargeTrigger = {
  thresholdAmountMinor: number
  type: 'balance'
}

/**
 * SDK-only type `CancelPurchaseParams`.
 */
export type CancelPurchaseParams = {
  purchaseRef: string
  reason?: string
}

/**
 * SDK overlay extending `CheckLimitRequest`.
 */
export type CheckLimitsRequest = components['schemas']['CheckLimitRequest'] & {
/**
 * When true, the backend mints a checkout session (or customer portal session for activation flows) and returns its URL / id on the response.
 */
  includeCheckoutSession?: boolean
}

/**
 * SDK-only type `CloneProductOverrides`.
 */
export type CloneProductOverrides = {
  name?: string
}

/**
 * SDK-only type `CloneProductResult`.
 */
export type CloneProductResult = {
  name: string
  reference: string
}

/**
 * SDK-only type `ConfigureMcpPlansResponse`.
 */
export type ConfigureMcpPlansResponse = {
  mcpServer: McpServerInfo
  planMap: Record<string, PlanMapEntry>
  product: components['schemas']['SdkProductResponse']
}

/**
 * SDK-only type `CreateCustomerResult`.
 */
export type CreateCustomerResult = {
  customerRef: string
}

/**
 * SDK-only type `CreatePaymentIntentParams`.
 */
export type CreatePaymentIntentParams = {
  currency?: string
  customerRef: string
  idempotencyKey?: string
  planRef: string
  productRef: string
}

/**
 * SDK-only type `CreatePaymentIntentResult`.
 */
export type CreatePaymentIntentResult = {
  accountId?: string
  amount: number
  clientSecret: string
  currency?: string
  exchangeRate?: number
  originalAmount?: number
  processorPaymentId: string
  publishableKey: string
  status?: string
}

/**
 * SDK overlay extending `CreatePlanRequest`.
 */
export type CreatePlanParams = components['schemas']['CreatePlanRequest'] & {
  productRef: string
}

/**
 * SDK-only type `CreateProductResult`.
 */
export type CreateProductResult = {
  name: string
  reference: string
}

/**
 * SDK-only type `CreateTopupPaymentIntentParams`.
 */
export type CreateTopupPaymentIntentParams = {
  amount: number
  autoRecharge?: AutoRechargeInput
  currency: string
  customerRef: string
  description?: string
  idempotencyKey?: string
}

/**
 * SDK-only type `CreateTopupPaymentIntentResult`.
 */
export type CreateTopupPaymentIntentResult = {
  accountId?: string
  clientSecret: string
  processorPaymentId: string
  publishableKey: string
}

/**
 * SDK-only type `CreditDisplayBlock`.
 */
export type CreditDisplayBlock = {
  amountMajor: number
  currency: string
  exchangeRate: number
  formatted: string
  rateSource: CreditDisplayBlockRateSource
}

/**
 * SDK mapped response overlay.
 */
export type CustomerResponseMapped = {
/**
 * Mapped from wire `reference`.
 */
  customerRef: string
  email?: string
  externalRef?: string
  name?: string
  plan?: string
  purchases?: Array<EnrichedPurchaseInfo>
}

/**
 * SDK-only type `DisableAutoRechargeParams`.
 */
export type DisableAutoRechargeParams = {
  customerRef: string
}

/**
 * SDK overlay extending `PurchaseInfo`.
 */
export type EnrichedPurchaseInfo = components['schemas']['PurchaseInfo'] & {
  nextBillingDate?: string
  paidAt?: string
}

/**
 * SDK-only type `GetAutoRechargeParams`.
 */
export type GetAutoRechargeParams = {
  customerRef: string
}

/**
 * SDK-only type `GetCustomerBalanceParams`.
 */
export type GetCustomerBalanceParams = {
  customerRef: string
}

/**
 * SDK-only type `GetCustomerBalanceResult`.
 */
export type GetCustomerBalanceResult = {
  credits: number
  creditsPerMinorUnit: number
  customerRef: string
  display?: CreditDisplayBlock
  displayCurrency: string
  displayExchangeRate: number
}

/**
 * SDK-only type `GetCustomerParams`.
 */
export type GetCustomerParams = {
  customerRef?: string
  email?: string
  externalRef?: string
}

/**
 * SDK-only type `GetPaymentMethodParams`.
 */
export type GetPaymentMethodParams = {
  customerRef: string
}

/**
 * SDK-only type `GetUserInfoParams`.
 */
export type GetUserInfoParams = {
  customerRef: string
  productRef: string
}

/**
 * SDK overlay extending `LimitResponse`.
 */
export type LimitResponseWithPlan = components['schemas']['LimitResponse'] & {
  plan: string
}

/**
 * List of `Plan`.
 */
export type ListPlansResult = Array<components['schemas']['Plan']>

/**
 * SDK-only type `ListProductItem`.
 */
export type ListProductItem = {
  description?: string
  name: string
  reference: string
}

/**
 * List of `ListProductItem`.
 */
export type ListProductsResult = Array<ListProductItem>

/**
 * SDK-only type `McpBootstrapResponse`.
 */
export type McpBootstrapResponse = {
  autoMappedTools?: Array<AutoMappedTool>
  mcpServer: McpServerInfo
  planMap: Record<string, PlanMapEntry>
  product: components['schemas']['SdkProductResponse']
  toolsAutoMapped?: boolean
}

/**
 * SDK-only type `McpServerInfo`.
 */
export type McpServerInfo = {
  defaultPlanRef?: string
  mcpProxyUrl?: string
  reference?: string
  subdomain?: string
  url: string
}

/**
 * SDK-only type `OneTimePurchaseInfo`.
 */
export type OneTimePurchaseInfo = {
  amount: number
  completedAt: string
  creditsAdded?: number
  currency: string
  productRef?: string
  reference: string
}

/**
 * Alias of `PaymentMethodResult`.
 */
export type PaymentMethodInfo = operations['PaymentMethodSdkController_getPaymentMethod']['responses']['200']['content']['application/json']

/**
 * SDK-only type `PlanMapEntry`.
 */
export type PlanMapEntry = {
  name?: string
  reference: string
}

/**
 * SDK-only type `ProcessPaymentIntentParams`.
 */
export type ProcessPaymentIntentParams = {
  customerRef: string
  paymentIntentId: string
  planRef?: string
  productRef?: string
}

/**
 * SDK-only type `ReactivatePurchaseParams`.
 */
export type ReactivatePurchaseParams = {
  purchaseRef: string
}

/**
 * SDK-only type `RetryOptions`.
 */
export type RetryOptions = {
  backoffStrategy?: RetryOptionsBackoffStrategy
  initialDelay?: number
  maxRetries?: number
  onRetry?: unknown
  shouldRetry?: unknown
}

/**
 * SDK overlay extending `AutoRechargeInput`.
 */
export type SaveAutoRechargeInput = AutoRechargeInput & {
  deferSetupIntent?: boolean
}

/**
 * SDK overlay extending `SaveAutoRechargeInput`.
 */
export type SaveAutoRechargeParams = SaveAutoRechargeInput & {
  customerRef: string
}

/**
 * SDK-only type `TaxBreakdown`.
 */
export type TaxBreakdown = {
  currency: string
  inclusive: boolean
  subtotal: number
  taxAmount: number
  taxRate: number
  total: number
  treatment: TaxBreakdownTreatment
}

/**
 * Projected union overlay.
 */
export type TopupProcessResult =
  | components['schemas']['ProcessPaymentProcessing']
  | components['schemas']['ProcessPaymentTimeout']
  | components['schemas']['ProcessPaymentFailed']
  | components['schemas']['ProcessPaymentCancelled']
  | TopupProcessResultSucceeded

/**
 * SDK-only type `TrackUsageBulkRequest`.
 */
export type TrackUsageBulkRequest = {
  events: Array<TrackUsageRequest>
}

/**
 * SDK overlay extending `CreateUsageRequest`.
 */
export type TrackUsageRequest = Partial<components['schemas']['CreateUsageRequest']> & {
  customerRef: string
  metadata?: Record<string, unknown>
}

/**
 * SDK-only type `UpdateCustomerParams`.
 */
export type UpdateCustomerParams = {
  email?: string
  externalRef?: string
  metadata?: Record<string, unknown>
  name?: string
  telephone?: string
}

/**
 * SDK-only type `UpdateCustomerResult`.
 */
export type UpdateCustomerResult = {
  customerRef: string
}

/**
 * Void / unit sentinel.
 */
export type Void = void

