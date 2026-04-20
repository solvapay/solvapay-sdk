/**
 * SolvaPay API Client Type Definitions
 *
 * Types related to the SolvaPay API client and backend communication.
 */

import type { components, operations } from './generated'

export type UsageMeterType = 'requests' | 'tokens'
export type CheckLimitsRequest = components['schemas']['CheckLimitRequest']

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
 * Result from processing a payment intent
 */
export interface ProcessPaymentResult {
  type: 'recurring' | 'one-time'
  purchase?: components['schemas']['PurchaseInfo']
  oneTimePurchase?: OneTimePurchaseInfo
  status: 'completed'
}

export type ActivatePlanResult = components['schemas']['ActivatePlanResponseDto']

/**
 * SDK-facing payment-method projection returned by
 * `GET /v1/sdk/payment-method?customerRef=...`.
 *
 * Hand-typed until the OpenAPI generator picks up the new endpoint (the
 * backend serves a discriminated union that openapi-typescript produces
 * as a plain `{ kind: string }` shape otherwise).
 */
export type PaymentMethodInfo =
  | {
      kind: 'card'
      brand: string
      last4: string
      expMonth: number
      expYear: number
    }
  | { kind: 'none' }

/**
 * SDK-facing merchant identity (source: GET /v1/sdk/merchant).
 *
 * Hand-typed here until the OpenAPI generator picks up the new endpoint.
 * Fields match `SdkMerchantResponseDto` on the backend.
 */
export type SdkMerchantResponse = {
  displayName: string
  legalName: string
  supportEmail?: string
  supportUrl?: string
  termsUrl?: string
  privacyUrl?: string
  country?: string
  defaultCurrency?: string
  statementDescriptor?: string
  logoUrl?: string
}

/** SDK-facing product projection. Sourced from the existing OpenAPI spec. */
export type SdkProductResponse = components['schemas']['SdkProductResponse']

export type McpBootstrapPlanInput =
  NonNullable<components['schemas']['McpBootstrapDto']['plans']>[number]

export type ToolPlanMappingInput =
  NonNullable<components['schemas']['McpBootstrapDto']['tools']>[number]

export type McpBootstrapRequest = components['schemas']['McpBootstrapDto']

export type McpToolPlanMappingInput =
  NonNullable<components['schemas']['ConfigureMcpPlansDto']['toolMapping']>[number]

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
  trackUsage(params: {
    customerRef: string
    actionType?: 'transaction' | 'api_call' | 'hour' | 'email' | 'storage' | 'custom'
    units?: number
    outcome?: 'success' | 'paywall' | 'fail'
    productRef?: string
    purchaseRef?: string
    description?: string
    metadata?: Record<string, unknown>
    duration?: number
    timestamp?: string
    idempotencyKey?: string
  }): Promise<void>

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

  /**
   * SDK-facing merchant identity (GET /v1/sdk/merchant).
   * Returns the subset of provider fields safe for browser consumption —
   * used by `<MandateText>`, `<CheckoutSummary>`, and trust signals.
   */
  getMerchant?(): Promise<SdkMerchantResponse>

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
  cloneProduct?(productRef: string, overrides?: { name?: string }): Promise<{
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
    idempotencyKey?: string
  }): Promise<{
    processorPaymentId: string
    clientSecret: string
    publishableKey: string
    accountId?: string
  }>

  // POST: /v1/sdk/payment-intents (purpose: credit_topup)
  createTopupPaymentIntent?(params: {
    customerRef: string
    amount: number
    currency: string
    description?: string
    idempotencyKey?: string
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
  processPaymentIntent?(params: {
    paymentIntentId: string
    productRef: string
    customerRef: string
    planRef?: string
  }): Promise<ProcessPaymentResult>

  // POST: /v1/sdk/user-info
  getUserInfo?(params: {
    customerRef: string
    productRef: string
  }): Promise<components['schemas']['UserInfoResponse']>

  // GET: /v1/sdk/customers/:customerRef/credits
  getCustomerBalance?(params: {
    customerRef: string
  }): Promise<{ customerRef: string; credits: number; displayCurrency: string; creditsPerMinorUnit: number; displayExchangeRate: number }>

  // POST: /v1/sdk/checkout-sessions
  createCheckoutSession(
    params: operations['CheckoutSessionSdkController_createCheckoutSession']['requestBody']['content']['application/json'],
  ): Promise<components['schemas']['CreateCheckoutSessionResponse']>

  // POST: /v1/sdk/customers/customer-sessions
  createCustomerSession(
    params: components['schemas']['CreateCustomerSessionRequest'],
  ): Promise<components['schemas']['CreateCustomerSessionResponse']>

  // POST: /v1/sdk/activate
  activatePlan?(
    params: components['schemas']['ActivatePlanDto'],
  ): Promise<ActivatePlanResult>

  // GET: /v1/sdk/payment-method?customerRef=...
  getPaymentMethod?(params: { customerRef: string }): Promise<PaymentMethodInfo>
}
