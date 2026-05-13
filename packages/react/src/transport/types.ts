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
import type {
  GetUsageResult,
  ProcessPaymentResult,
  TopupProcessResult,
  PaymentMethodInfo,
} from '@solvapay/server'

export interface TransportBalanceResult {
  credits: number
  displayCurrency: string
  creditsPerMinorUnit: number
  displayExchangeRate: number
}

/**
 * Runtime allowance projection consumed by `useLimits`. Mirrors the
 * subset of `@solvapay/server`'s `LimitResponse` that the React side
 * actually renders — `plans` / `balance` / `product` are deliberately
 * omitted because they duplicate fields other hooks (`usePlans`,
 * `useBalance`) already surface.
 */
export interface TransportLimitsResult {
  withinLimits: boolean
  remaining: number
  meterName: string | null
  /**
   * True when the backend's default plan requires explicit activation
   * (free or paid). Customer has zero entitlement until `activatePlan`
   * runs. Distinguishes "exhausted free tier" (`activationRequired:
   * false, remaining: 0`) from "free tier waiting to be claimed"
   * (`activationRequired: true, remaining: 0`). Free recurring plans
   * with `default: true` skip this — the backend treats them as
   * auto-allocated.
   */
  activationRequired: boolean
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
  /**
   * Read tools. HTTP transports implement these via `GET /api/*` routes.
   * MCP adapters omit them because the data is delivered on the
   * bootstrap payload (see `BootstrapPayload.customer` / `merchant` /
   * `product` / `plans` in `@solvapay/mcp`). Hooks consume these via
   * module-level caches that the MCP host seeds at mount time, so the
   * transport path is only exercised on HTTP.
   */
  checkPurchase?: () => Promise<CustomerPurchaseData>
  getBalance?: () => Promise<TransportBalanceResult>
  getMerchant?: () => Promise<Merchant>
  getProduct?: (productRef: string) => Promise<Product>
  listPlans?: (productRef: string) => Promise<Plan[]>
  /**
   * Fetch the customer's default payment method for rendering under
   * `<CurrentPlanCard>`. Returns `{ kind: 'none' }` when no card is on
   * file — the SDK treats both that and a throw as "hide the section".
   * HTTP transports implement via `GET /api/payment-method`; MCP
   * adapters omit (the field is on the bootstrap customer snapshot).
   */
  getPaymentMethod?: () => Promise<PaymentMethodInfo>
  /**
   * Optional: fetch the authenticated customer's usage snapshot for the
   * active usage-based plan. When omitted, `useUsage()` falls back to
   * reading the usage field out of `checkPurchase`.
   */
  getUsage?: () => Promise<GetUsageResult>
  /**
   * Optional: fetch the customer's runtime allowance for a (product, meter)
   * pair. HTTP transports implement via
   * `GET /api/limits?productRef=…&meterName=…`. MCP adapters typically omit
   * — the value lives on the bootstrap payload and refreshes via
   * `refreshBootstrap()`. When undefined, `useLimits()` returns `null` for
   * `remaining` / `withinLimits` with `loading: false` (graceful fallback,
   * matching `useUsage`'s behaviour when `getUsage` is absent).
   */
  getLimits?: (params: {
    productRef: string
    meterName?: string
  }) => Promise<TransportLimitsResult>

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

  /**
   * Process a credit-topup payment intent after Stripe's `confirmPayment`
   * resolves. Mirrors `processPayment` but for the topup branch — by the
   * time this resolves, the backend has observed the PI reach
   * `succeeded` AND the webhook handler has booked the credit transaction.
   *
   * Optional: transports that can't run the synchronous round-trip
   * (e.g. early MCP adapter builds, custom integrations) omit this and
   * `TopupForm.onSuccess` fires immediately on Stripe confirm — the
   * legacy behaviour. The HTTP transport always implements it; new
   * transports SHOULD too.
   */
  processTopupPayment?: (params: {
    paymentIntentId: string
  }) => Promise<TopupProcessResult>

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
}

export class UnsupportedTransportMethodError extends Error {
  readonly method: string

  constructor(method: string) {
    super(`SolvaPay transport does not implement "${method}"`)
    this.name = 'UnsupportedTransportMethodError'
    this.method = method
  }
}
