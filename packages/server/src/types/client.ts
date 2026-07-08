/**
 * SolvaPay API Client Type Definitions
 *
 * Types related to the SolvaPay API client and backend communication.
 */

import type { components, operations } from './generated'
import type { BusinessDetailsInput, TaxBreakdown } from '@solvapay/core'

export type AttachBusinessDetailsParams = {
  paymentIntentId: string
  customerRef?: string
} & BusinessDetailsInput

export type AttachBusinessDetailsResult = {
  taxBreakdown: TaxBreakdown
}

export type UsageMeterType = 'requests' | 'tokens'
export type CheckLimitsRequest = components['schemas']['CheckLimitRequest'] & {
  /**
   * When `true`, the backend mints a checkout session (or customer
   * portal session for activation flows) and returns its URL / id on
   * the response. Default `false` so read-only callers like
   * `useLimits` / `checkLimitsCore` stop creating orphan
   * `CheckoutSession` documents and firing spurious
   * `checkout_session.created` webhooks on every refetch.
   *
   * `paywall.decide()` opts in because it bakes the URL into the
   * 402 `PaywallStructuredContent`.
   *
   * NOTE: this intersection is a temporary stand-in until the
   * backend OpenAPI spec is republished and `generated.ts` is
   * regenerated to include the field natively.
   */
  includeCheckoutSession?: boolean
}

/**
 * Extended LimitResponse with SDK-added plan field
 */
export type LimitResponseWithPlan = components['schemas']['LimitResponse'] & {
  plan: string
}

/**
 * Extended CustomerResponse with proper field mapping
 *
 * Note: The backend API returns purchases as PurchaseInfo objects.
 * Additional fields (paidAt, nextBillingDate) may be present in the response.
 */
export type CustomerResponseMapped = {
  customerRef: string
  email?: string
  name?: string
  externalRef?: string
  plan?: string
  purchases?: Array<
    components['schemas']['PurchaseInfo'] & {
      paidAt?: string
      nextBillingDate?: string
    }
  >
}

/**
 * One-time purchase information returned from payment processing
 */
export interface OneTimePurchaseInfo {
  reference: string
  productRef?: string
  amount: number
  currency: string
  creditsAdded?: number
  completedAt: string
}

/**
 * Result from processing a payment intent.
 *
 * Mirrors the backend's discriminated `oneOf` response. The `succeeded`
 * branches are further discriminated on `type` so consumers can route to
 * recurring vs one-time purchase handling without guarding against
 * `purchase === undefined`. A bare `{ status: 'succeeded' }` is returned
 * when the webhook race means the backend can't yet enrich the response
 * with the created purchase — callers should fall back to refetching.
 *
 * `failed` and `cancelled` are returned by the backend when the Stripe
 * PaymentIntent is in a terminal non-success state and are routed to
 * `onError` by `reconcilePayment`. `timeout` carries a retry hint and is
 * routed to the timeout branch.
 */
export type ProcessPaymentResult =
  | {
      status: 'succeeded'
      type: 'recurring'
      purchase: components['schemas']['PurchaseInfo']
    }
  | {
      status: 'succeeded'
      type: 'one-time'
      oneTimePurchase: OneTimePurchaseInfo
    }
  | { status: 'succeeded' }
  | { status: 'processing' }
  | { status: 'timeout'; message?: string }
  | { status: 'failed' }
  | { status: 'cancelled' }

/**
 * Result from processing a credit-topup payment intent.
 *
 * Narrower projection of {@link ProcessPaymentResult} — topups don't
 * create a `PurchaseInfo` row (they book a `TOPUP` credit transaction
 * via the webhook handler), so the `type: 'recurring' | 'one-time'`
 * branches are stripped. The remaining four statuses match the
 * backend's `/sdk/payment-intents/:id/process` response verbatim and
 * are what the SDK's `processTopupPayment` exposes to `TopupForm`.
 *
 * `succeeded` means the backend observed the PI reach succeeded AND
 * the credit transaction has been booked (see step 5 of
 * `stripe-payment-webhook.handler.ts` — credit booking happens in the
 * same handler invocation that flips PI status). `timeout` carries a
 * soft retry hint; `failed` / `cancelled` route to the error branch.
 *
 * `creditsAdded` is the wallet delta observed by the backend helper's
 * post-process balance poll (`processTopupPaymentIntentCore`). When
 * present, the React side bumps `balance.adjustBalance(creditsAdded)`
 * for an instant optimistic UI before the deterministic
 * `refetchPurchase()` lands. Absent when the helper's poll budget
 * exhausted (rare — the webhook was genuinely stalled) OR when the
 * baseline capture failed (legacy `SolvaPayClient` adapters without
 * `getCustomerBalance`); callers fall back to refetch-only.
 */
export type TopupProcessResult =
  | { status: 'succeeded'; creditsAdded?: number }
  | { status: 'processing' }
  | { status: 'timeout'; message?: string }
  | { status: 'failed' }
  | { status: 'cancelled' }

export type ActivatePlanResult = components['schemas']['ActivatePlanResponseDto']

/**
 * SDK-facing payment-method projection returned by
 * `GET /v1/sdk/payment-method?customerRef=...`.
 *
 * Derived from the generated operation response so any backend shape
 * change propagates through a single `npm run generate:types` run. The
 * inline `oneOf` schema on the backend controller translates to a clean
 * `{ kind: 'card', ... } | { kind: 'none' }` discriminated union here.
 */
export type PaymentMethodInfo =
  operations['PaymentMethodSdkController_getPaymentMethod']['responses']['200']['content']['application/json']

export type AutoRechargeStatus = 'active' | 'disabled' | 'failed' | 'pending_setup'

export type AutoRechargeConfig = {
  enabled: boolean
  trigger: { type: 'balance'; thresholdAmountMinor: number }
  topup: { mode: 'fixed'; amountMinor: number; currency: string }
  fundingSourceType?: 'saved_card' | 'tokenized_card'
  paymentMethodId?: string
  status: AutoRechargeStatus
  failureCount: number
  lastChargeAt?: string
  updatedAt?: string
  /** Backend-computed display values — render verbatim; do not derive from trigger fields. */
  display?: AutoRechargeDisplayBlock
}

export type AutoRechargeDisplayBlock = {
  thresholdAmountMajor: number
  topupAmountMajor: number
  currency: string
  formatted: {
    threshold: string
    topup: string
  }
  exchangeRate: number
  rateSource: 'parity' | 'db' | 'fallback'
}

export type CreditDisplayBlock = {
  amountMajor: number
  currency: string
  formatted: string
  exchangeRate: number
  rateSource: 'parity' | 'db' | 'fallback'
}

export type AutoRechargeInput = {
  enabled: boolean
  triggerType: 'balance'
  thresholdAmountMajor?: number
  topupAmountMajor?: number
  maxRecharges?: number
  currency: string
}

/** PUT /sdk/auto-recharge — input plus request-only flags. */
export type SaveAutoRechargeInput = AutoRechargeInput & {
  deferSetupIntent?: boolean
}

export type AutoRechargeResponse = {
  config: AutoRechargeConfig | null
  display?: AutoRechargeDisplayBlock
}

export type SaveAutoRechargeResponse = {
  config: AutoRechargeConfig
  display?: AutoRechargeDisplayBlock
  setupClientSecret?: string
  publishableKey?: string
  stripeAccountId?: string
}

/**
 * SDK-facing merchant identity (source: GET /v1/sdk/merchant).
 */
export type SdkMerchantResponse = components['schemas']['SdkMerchantResponseDto']

/**
 * SDK-facing platform config (source: GET /v1/sdk/platform-config).
 *
 * Environment-aware platform values resolved against the authenticated
 * provider. Primary consumer today is the MCP checkout app, which uses
 * `stripePublishableKey` to boot Stripe.js for a CSP probe before a
 * PaymentIntent exists.
 */
export type SdkPlatformConfigResponse = components['schemas']['SdkPlatformConfigResponseDto']

/** SDK-facing product projection. Sourced from the existing OpenAPI spec. */
export type SdkProductResponse = components['schemas']['SdkProductResponse']

export type CreditDebitSkipReason = components['schemas']['CreditDebitSkippedResponse']['reason']

export type CreditDebitResult =
  | components['schemas']['CreditDebitSuccessResponse']
  | components['schemas']['CreditDebitSkippedResponse']

/**
 * When `debited: true` and `autoRecharge.triggered: true`, the server initiated
 * an off-session charge — credits are booked asynchronously via webhook, not inline.
 */
export type CreditDebitSuccess = components['schemas']['CreditDebitSuccessResponse']

export type TrackUsageRequest = Omit<
  Partial<components['schemas']['CreateUsageRequest']>,
  'customerRef' | 'metadata'
> & {
  customerRef: string
  metadata?: Record<string, unknown>
}

export type TrackUsageResponse = components['schemas']['UsageRecordResponse']

export interface TrackUsageBulkRequest {
  events: TrackUsageRequest[]
}

export type TrackUsageBulkResponse = components['schemas']['BulkUsageResponse']

export type AssignCreditsRequest = components['schemas']['GrantCustomerCreditsRequest'] & {
  customerRef: string
  idempotencyKey?: string
}

export type AssignCreditsResponse = components['schemas']['GrantCustomerCreditsResponse']

export type McpBootstrapPlanInput = NonNullable<
  components['schemas']['McpBootstrapDto']['plans']
>[number]

export type ToolPlanMappingInput = NonNullable<
  components['schemas']['McpBootstrapDto']['tools']
>[number]

export type McpBootstrapRequest = components['schemas']['McpBootstrapDto']

export type McpToolPlanMappingInput = NonNullable<
  components['schemas']['ConfigureMcpPlansDto']['toolMapping']
>[number]

export interface McpBootstrapResponse {
  product: components['schemas']['SdkProductResponse']
  mcpServer: {
    reference?: string
    subdomain?: string
    mcpProxyUrl?: string
    url: string
    defaultPlanRef?: string
  }
  planMap: Record<string, { reference: string; name?: string }>
  toolsAutoMapped?: boolean
  autoMappedTools?: Array<{ name: string; description?: string }>
}

export type ConfigureMcpPlansRequest = components['schemas']['ConfigureMcpPlansDto']

export interface ConfigureMcpPlansResponse {
  product: components['schemas']['SdkProductResponse']
  mcpServer: {
    reference?: string
    subdomain?: string
    mcpProxyUrl?: string
    url: string
    defaultPlanRef?: string
  }
  planMap: Record<string, { reference: string; name?: string }>
}

/**
 * SolvaPay API Client Interface
 *
 * This interface defines the contract for communicating with the SolvaPay backend.
 * Uses auto-generated types from the OpenAPI specification.
 * You can provide your own implementation or use the default createSolvaPayClient().
 */
export interface SolvaPayClient {
  // POST: /v1/sdk/limits
  checkLimits(params: CheckLimitsRequest): Promise<LimitResponseWithPlan>

  // POST: /v1/sdk/usages
  trackUsage(params: TrackUsageRequest): Promise<TrackUsageResponse>

  // POST: /v1/sdk/usages/bulk
  trackUsageBulk?(params: TrackUsageBulkRequest): Promise<TrackUsageBulkResponse>

  // POST: /v1/sdk/customers
  createCustomer?(
    params: components['schemas']['CreateCustomerRequest'],
  ): Promise<{ customerRef: string }>

  /**
   * PATCH: /v1/sdk/customers/{customerRef}
   * Update mutable customer fields. Used by `ensureCustomer` to backfill
   * `externalRef` on an existing email-matched customer, and exposed
   * directly for integrators who need it.
   */
  updateCustomer?(
    customerRef: string,
    params: {
      email?: string
      name?: string
      telephone?: string
      metadata?: Record<string, unknown>
      externalRef?: string
    },
  ): Promise<{ customerRef: string }>

  // GET: /v1/sdk/customers/{reference} or /v1/sdk/customers?externalRef={externalRef}
  getCustomer(params: {
    customerRef?: string
    externalRef?: string
    email?: string
  }): Promise<CustomerResponseMapped>

  // POST: /v1/sdk/customers/{customerRef}/credits
  assignCredits?(params: AssignCreditsRequest): Promise<AssignCreditsResponse>

  /**
   * SDK-facing merchant identity (GET /v1/sdk/merchant).
   * Returns the subset of provider fields safe for browser consumption —
   * used by `<MandateText>`, `<CheckoutSummary>`, and trust signals.
   */
  getMerchant?(): Promise<SdkMerchantResponse>

  /**
   * SDK-facing platform config (GET /v1/sdk/platform-config).
   * Returns environment-aware browser-safe values (resolved sandbox/live
   * against the authenticated provider). Primary consumer today is the
   * MCP checkout app, which uses `stripePublishableKey` to boot Stripe.js
   * for a CSP probe before a PaymentIntent exists.
   */
  getPlatformConfig?(): Promise<SdkPlatformConfigResponse>

  // GET: /v1/sdk/products/{productRef}
  getProduct?(productRef: string): Promise<SdkProductResponse>

  // Management methods

  // GET: /v1/sdk/products
  listProducts?(): Promise<
    Array<{
      reference: string
      name: string
      description?: string
      status?: string
    }>
  >

  // POST: /v1/sdk/products
  createProduct?(params: components['schemas']['CreateProductRequest']): Promise<{
    reference: string
    name: string
  }>

  // POST: /v1/sdk/products/mcp/bootstrap
  bootstrapMcpProduct?(params: McpBootstrapRequest): Promise<McpBootstrapResponse>

  // PUT: /v1/sdk/products/{productRef}/mcp/plans
  configureMcpPlans?(
    productRef: string,
    params: ConfigureMcpPlansRequest,
  ): Promise<ConfigureMcpPlansResponse>

  // PUT: /v1/sdk/products/{productRef}
  updateProduct?(
    productRef: string,
    params: components['schemas']['UpdateProductRequest'],
  ): Promise<components['schemas']['SdkProductResponse']>

  // DELETE: /v1/sdk/products/{productRef}
  deleteProduct?(productRef: string): Promise<void>

  // POST: /v1/sdk/products/{productRef}/clone
  cloneProduct?(
    productRef: string,
    overrides?: { name?: string },
  ): Promise<{
    reference: string
    name: string
  }>

  // GET: /v1/sdk/products/{productRef}/plans
  listPlans?(productRef: string): Promise<components['schemas']['Plan'][]>

  // POST: /v1/sdk/products/{productRef}/plans
  createPlan?(
    params: components['schemas']['CreatePlanRequest'] & { productRef: string },
  ): Promise<components['schemas']['Plan']>

  // PUT: /v1/sdk/products/{productRef}/plans/{planRef}
  updatePlan?(
    productRef: string,
    planRef: string,
    params: components['schemas']['UpdatePlanRequest'],
  ): Promise<components['schemas']['Plan']>

  // DELETE: /v1/sdk/products/{productRef}/plans/{planRef}
  deletePlan?(productRef: string, planRef: string): Promise<void>

  // POST: /v1/sdk/payment-intents
  createPaymentIntent?(params: {
    productRef: string
    planRef: string
    customerRef: string
    currency?: string
    idempotencyKey?: string
  }): Promise<{
    processorPaymentId: string
    clientSecret: string
    publishableKey: string
    accountId?: string
    /** USD ledger amount in minor units. */
    amount: number
    /** Presentment amount in minor units (matches `currency`). */
    originalAmount?: number
    currency?: string
    exchangeRate?: number
    status?: string
  }>

  // POST: /v1/sdk/payment-intents (purpose: credit_topup)
  createTopupPaymentIntent?(params: {
    customerRef: string
    amount: number
    currency: string
    description?: string
    idempotencyKey?: string
    autoRecharge?: AutoRechargeInput
  }): Promise<{
    processorPaymentId: string
    clientSecret: string
    publishableKey: string
    accountId?: string
  }>

  // POST: /v1/sdk/purchases/{purchaseRef}/cancel
  cancelPurchase?(params: {
    purchaseRef: string
    reason?: string
  }): Promise<components['schemas']['PurchaseInfo']>

  // POST: /v1/sdk/purchases/{purchaseRef}/reactivate
  reactivatePurchase?(params: {
    purchaseRef: string
  }): Promise<components['schemas']['PurchaseInfo']>

  // POST: /v1/sdk/payment-intents/{paymentIntentId}/process
  // `productRef` is optional because credit-topup PIs (no product) are
  // processed through the same route — the backend controller ignores
  // the body entirely and drives off the PI id + authenticated provider.
  processPaymentIntent?(params: {
    paymentIntentId: string
    productRef?: string
    customerRef: string
    planRef?: string
  }): Promise<ProcessPaymentResult>

  // POST: /v1/sdk/payment-intents/{paymentIntentId}/business-details
  attachBusinessDetails?(
    params: AttachBusinessDetailsParams,
  ): Promise<AttachBusinessDetailsResult>

  // POST: /v1/sdk/user-info
  getUserInfo?(params: {
    customerRef: string
    productRef: string
  }): Promise<components['schemas']['UserInfoResponse']>

  // GET: /v1/sdk/customers/:customerRef/credits
  getCustomerBalance?(params: { customerRef: string }): Promise<{
    customerRef: string
    credits: number
    displayCurrency: string
    creditsPerMinorUnit: number
    displayExchangeRate: number
    display?: CreditDisplayBlock
  }>

  // POST: /v1/sdk/checkout-sessions
  createCheckoutSession(
    params: operations['CheckoutSessionSdkController_createCheckoutSession']['requestBody']['content']['application/json'],
  ): Promise<components['schemas']['CreateCheckoutSessionResponse']>

  // POST: /v1/sdk/customers/customer-sessions
  createCustomerSession(
    params: components['schemas']['CreateCustomerSessionRequest'],
  ): Promise<components['schemas']['CreateCustomerSessionResponse']>

  // POST: /v1/sdk/activate
  activatePlan?(params: components['schemas']['ActivatePlanDto']): Promise<ActivatePlanResult>

  // GET: /v1/sdk/payment-method?customerRef=...
  getPaymentMethod?(params: { customerRef: string }): Promise<PaymentMethodInfo>

  // GET: /v1/sdk/auto-recharge?customerRef=...
  getAutoRecharge?(params: { customerRef: string }): Promise<AutoRechargeResponse>

  // PUT: /v1/sdk/auto-recharge
  saveAutoRecharge?(
    params: SaveAutoRechargeInput & { customerRef: string },
  ): Promise<SaveAutoRechargeResponse>

  // DELETE: /v1/sdk/auto-recharge?customerRef=...
  disableAutoRecharge?(params: { customerRef: string }): Promise<{ success: true }>
}
