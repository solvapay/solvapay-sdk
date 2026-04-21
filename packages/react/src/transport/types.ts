/**
 * Unified data-access surface for `@solvapay/react`.
 *
 * By default, `SolvaPayProvider` builds an HTTP transport from `config.api` +
 * `config.fetch`. Integrators who need to route those calls somewhere else
 * (e.g. an MCP host tunnelling through `app.callServerTool`) pass a
 * `transport` on the provider config, replacing every call at once.
 *
 * See `@solvapay/react/mcp` for the canonical non-HTTP implementation.
 */

import type {
  CustomerPurchaseData,
  PaymentIntentResult,
  TopupPaymentResult,
  PrefillCustomer,
  CancelResult,
  ReactivateResult,
  ActivatePlanResult,
  Merchant,
  Product,
  Plan,
} from '../types'
import type { GetUsageResult, ProcessPaymentResult, PaymentMethodInfo } from '@solvapay/server'

export interface TransportBalanceResult {
  credits: number
  displayCurrency: string
  creditsPerMinorUnit: number
  displayExchangeRate: number
}

/** Re-exported from `@solvapay/server` for transport consumers. */
export type TransportUsageResult = GetUsageResult

export interface TransportCheckoutSessionResult {
  checkoutUrl: string
}

export interface TransportCustomerSessionResult {
  customerUrl: string
}

/**
 * Every method is required. Transports that can't honour a method should
 * throw `UnsupportedTransportMethodError` from that method so callers can
 * feature-detect with `catch (err) { if (err instanceof UnsupportedTransportMethodError) ... }`.
 *
 * For the MCP adapter, this is usually unnecessary: `app.callServerTool`
 * already returns a structured error when the server doesn't expose the
 * tool, and the adapter propagates that straight through.
 */
export interface SolvaPayTransport {
  checkPurchase: () => Promise<CustomerPurchaseData>

  createPayment: (params: {
    planRef?: string
    productRef?: string
    customer?: PrefillCustomer
  }) => Promise<PaymentIntentResult>

  processPayment: (params: {
    paymentIntentId: string
    productRef: string
    planRef?: string
  }) => Promise<ProcessPaymentResult>

  createTopupPayment: (params: {
    amount: number
    currency?: string
  }) => Promise<TopupPaymentResult>

  getBalance: () => Promise<TransportBalanceResult>

  cancelRenewal: (params: { purchaseRef: string; reason?: string }) => Promise<CancelResult>

  reactivateRenewal: (params: { purchaseRef: string }) => Promise<ReactivateResult>

  activatePlan: (params: {
    productRef: string
    planRef: string
  }) => Promise<ActivatePlanResult>

  createCheckoutSession: (params?: {
    planRef?: string
    productRef?: string
    returnUrl?: string
  }) => Promise<TransportCheckoutSessionResult>

  createCustomerSession: () => Promise<TransportCustomerSessionResult>

  getMerchant: () => Promise<Merchant>

  getProduct: (productRef: string) => Promise<Product>

  listPlans: (productRef: string) => Promise<Plan[]>

  /**
   * Fetch the customer's default payment method for rendering under
   * `<CurrentPlanCard>`. Returns `{ kind: 'none' }` when no card is on
   * file — the SDK treats both that and a throw as "hide the section".
   *
   * Sourced from `GET /v1/sdk/payment-method` on HTTP transports and from
   * the `get_payment_method` MCP tool on MCP adapters.
   */
  getPaymentMethod: () => Promise<PaymentMethodInfo>

  /**
   * Optional: fetch the authenticated customer's usage snapshot for the
   * active usage-based plan. When omitted, `useUsage()` falls back to
   * reading the usage field out of `checkPurchase`.
   */
  getUsage?: () => Promise<GetUsageResult>
}

export class UnsupportedTransportMethodError extends Error {
  readonly method: string

  constructor(method: string) {
    super(`SolvaPay transport does not implement "${method}"`)
    this.name = 'UnsupportedTransportMethodError'
    this.method = method
  }
}
