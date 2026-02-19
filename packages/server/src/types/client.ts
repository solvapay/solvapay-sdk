/**
 * SolvaPay API Client Type Definitions
 *
 * Types related to the SolvaPay API client and backend communication.
 */

import type { components } from './generated'

/**
 * Extended LimitResponse with plan field
 */
export type LimitResponseWithPlan = components['schemas']['LimitResponse'] & { plan: string }

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

/**
 * SolvaPay API Client Interface
 *
 * This interface defines the contract for communicating with the SolvaPay backend.
 * Uses auto-generated types from the OpenAPI specification.
 * You can provide your own implementation or use the default createSolvaPayClient().
 */
export interface SolvaPayClient {
  // POST: /v1/sdk/limits
  checkLimits(params: components['schemas']['CheckLimitRequest']): Promise<LimitResponseWithPlan>

  // POST: /v1/sdk/usages
  trackUsage(params: {
    customerRef: string
    productRef: string
    planRef: string
    outcome: string
    action?: string
    requestId?: string
    actionDuration?: number
    timestamp?: string
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

  // PUT: /v1/sdk/products/{productRef}
  updateProduct?(
    productRef: string,
    params: components['schemas']['UpdateProductRequest'],
  ): Promise<components['schemas']['SdkProductResponse']>

  // DELETE: /v1/sdk/products/{productRef}
  deleteProduct?(productRef: string): Promise<void>

  // GET: /v1/sdk/products/{productRef}/plans
  listPlans?(productRef: string): Promise<
    Array<{
      reference: string
      name: string
      description?: string
      price?: number
      currency?: string
      interval?: string
      isFreeTier?: boolean
      freeUnits?: number
      metadata?: Record<string, any>
      [key: string]: any
    }>
  >

  // POST: /v1/sdk/products/{productRef}/plans
  createPlan?(
    params: components['schemas']['CreatePlanRequest'] & { productRef: string },
  ): Promise<{
    reference: string
    name: string
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

  // POST: /v1/sdk/checkout-sessions
  createCheckoutSession(
    params: components['schemas']['CreateCheckoutSessionRequest'],
  ): Promise<components['schemas']['CheckoutSessionResponse']>

  // POST: /v1/sdk/customers/customer-sessions
  createCustomerSession(
    params: components['schemas']['CreateCustomerSessionRequest'],
  ): Promise<components['schemas']['CreateCustomerSessionResponse']>
}
