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

export interface McpBootstrapPlanInput {
  key: string
  name: string
  /** Price in cents (e.g. 2000 = $20.00) */
  price: number
  currency: string
  billingCycle?: 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom'
  type?: 'recurring' | 'one-time' | 'usage-based'
  freeUnits?: number
  meterId?: string
  limit?: number
  features?: Record<string, unknown>
}

export interface ToolPlanMappingInput {
  name: string
  description?: string
  noPlan?: boolean
  planIds?: string[]
  planRefs?: string[]
  planKeys?: string[]
}

export interface McpToolPlanMappingInput {
  name: string
  planKeys: string[]
}

export interface McpBootstrapRequest {
  name?: string
  description?: string
  imageUrl?: string
  productType?: string
  originUrl: string
  /** Optional token combined with provider name to derive the final MCP subdomain. */
  mcpDomain?: string
  authHeaderName?: string
  authApiKey?: string
  plans?: McpBootstrapPlanInput[]
  tools?: ToolPlanMappingInput[]
  metadata?: Record<string, unknown>
}

export interface McpBootstrapResponse {
  product: components['schemas']['SdkProductResponse']
  mcpServer: {
    id?: string
    reference?: string
    subdomain?: string
    mcpProxyUrl?: string
    url: string
    defaultPlanId?: string
  }
  planMap: Record<string, { id: string; reference: string; name?: string }>
  toolsAutoMapped?: boolean
  autoMappedTools?: Array<{ name: string; description?: string }>
}

export interface ConfigureMcpPlansRequest {
  plans?: McpBootstrapPlanInput[]
  toolMapping?: McpToolPlanMappingInput[]
}

export interface ConfigureMcpPlansResponse {
  product: components['schemas']['SdkProductResponse']
  mcpServer: {
    id?: string
    reference?: string
    subdomain?: string
    mcpProxyUrl?: string
    url: string
    defaultPlanId?: string
  }
  planMap: Record<string, { id: string; reference: string; name?: string }>
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
    productReference?: string
    purchaseReference?: string
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

  // GET: /v1/sdk/customers/{reference} or /v1/sdk/customers?externalRef={externalRef}
  getCustomer(params: {
    customerRef?: string
    externalRef?: string
    email?: string
  }): Promise<CustomerResponseMapped>

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
  listPlans?(productRef: string): Promise<
    Array<{
      reference: string
      price?: number
      currency?: string
      interval?: string
      freeUnits?: number
      measures?: string
      limit?: number
      pricePerUnit?: number
      billingModel?: string
      metadata?: Record<string, unknown>
      [key: string]: unknown
    }>
  >

  // POST: /v1/sdk/products/{productRef}/plans
  createPlan?(
    params: components['schemas']['CreatePlanRequest'] & { productRef: string },
  ): Promise<{
    reference: string
  }>

  // PUT: /v1/sdk/products/{productRef}/plans/{planRef}
  updatePlan?(
    productRef: string,
    planRef: string,
    params: Partial<components['schemas']['CreatePlanRequest']>,
  ): Promise<{
    reference: string
    [key: string]: unknown
  }>

  // DELETE: /v1/sdk/products/{productRef}/plans/{planRef}
  deletePlan?(productRef: string, planRef: string): Promise<void>

  // POST: /v1/sdk/payment-intents
  createPaymentIntent?(params: {
    productRef: string
    planRef: string
    customerRef: string
    idempotencyKey?: string
  }): Promise<{
    id: string
    clientSecret: string
    publishableKey: string
    accountId?: string
  }>

  // POST: /v1/sdk/purchases/{purchaseRef}/cancel
  cancelPurchase?(params: {
    purchaseRef: string
    reason?: string
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

  // POST: /v1/sdk/checkout-sessions
  createCheckoutSession(
    params: operations['CheckoutSessionSdkController_createCheckoutSession']['requestBody']['content']['application/json'],
  ): Promise<components['schemas']['CreateCheckoutSessionResponse']>

  // POST: /v1/sdk/customers/customer-sessions
  createCustomerSession(
    params: components['schemas']['CreateCustomerSessionRequest'],
  ): Promise<components['schemas']['CreateCustomerSessionResponse']>
}
