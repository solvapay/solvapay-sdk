/**
 * TypeScript type definitions for @solvapay/react
 */

import type { PaymentIntent } from '@stripe/stripe-js'
import type {
  ProcessPaymentResult,
  ActivatePlanResult,
  PaymentMethodInfo,
} from '@solvapay/server'
import type { AuthAdapter } from '../adapters/auth'
import type { PartialSolvaPayCopy } from '../i18n/types'
import type { SolvaPayTransport } from '../transport/types'

export interface PurchaseInfo {
  reference: string
  productName: string
  productRef?: string
  status: string
  startDate: string
  endDate?: string
  cancelledAt?: string
  cancellationReason?: string
  amount?: number
  currency?: string
  planType?: string
  isRecurring?: boolean
  nextBillingDate?: string
  billingCycle?: string
  planRef?: string
  planSnapshot?: {
    reference?: string
    price?: number
    meterRef?: string
    limit?: number
    freeUnits?: number
    creditsPerUnit?: number
    planType?: string
    billingCycle?: string | null
    features?: Record<string, unknown> | null
  }
  usage?: {
    used: number
    overageUnits?: number
    overageCost?: number
    periodStart?: string
    periodEnd?: string
  }
}

export interface CustomerPurchaseData {
  customerRef?: string
  email?: string
  name?: string
  purchases: PurchaseInfo[]
}

export interface PaymentIntentResult {
  clientSecret: string
  publishableKey: string
  accountId?: string
  customerRef?: string // Backend customer reference
}

/**
 * Subset of merchant identity surfaced by `GET /v1/sdk/merchant`.
 * Used by `<MandateText>` and customer-facing trust signals.
 */
export interface Merchant {
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

export interface UseMerchantReturn {
  merchant: Merchant | null
  loading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

export interface Product {
  reference: string
  name?: string
  description?: string
  status?: string
  [key: string]: unknown
}

export interface UseProductReturn {
  product: Product | null
  loading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

export interface UsePlanOptions {
  /** Plan reference (e.g. `'pln_premium'`). */
  planRef?: string
  /**
   * Optional product reference. When provided, the hook reuses the
   * `usePlans` cache instead of fetching a dedicated plan endpoint.
   */
  productRef?: string
  /**
   * Fetcher for plan lookup when `productRef` is not provided. Required in
   * that mode so the hook stays dependency-free.
   */
  fetcher?: (productRef: string) => Promise<Plan[]>
}

export interface UsePlanReturn {
  plan: Plan | null
  loading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

/**
 * Optional customer fields forwarded to payment-intent creation so the
 * backend customer record is authoritative. Read back via `useCustomer()`
 * after the intent is created.
 */
export interface PrefillCustomer {
  name?: string
  email?: string
}

export interface TopupPaymentResult {
  clientSecret: string
  publishableKey: string
  accountId?: string
  customerRef?: string
}

export interface UseTopupOptions {
  amount: number
  currency?: string
}

export interface UseTopupReturn {
  loading: boolean
  error: Error | null
  stripePromise: Promise<import('@stripe/stripe-js').Stripe | null> | null
  clientSecret: string | null
  startTopup: () => Promise<void>
  reset: () => void
}

export interface TopupFormProps {
  amount: number
  currency?: string
  onSuccess?: (paymentIntent: PaymentIntent) => void
  onError?: (error: Error) => void
  returnUrl?: string
  submitButtonText?: string
  className?: string
  buttonClassName?: string
}

export interface PurchaseStatus {
  loading: boolean
  /** True when data already exists but a background refetch is in progress */
  isRefetching: boolean
  /** Last fetch error, or null if the most recent fetch succeeded */
  error: Error | null
  customerRef?: string
  email?: string
  name?: string
  purchases: PurchaseInfo[]
  hasProduct: (productName: string) => boolean
  /**
   * Primary active purchase (paid or free) - most recent purchase with status === 'active'
   * Backend keeps purchases as 'active' until expiration, even when cancelled.
   * null if no active purchase exists
   */
  activePurchase: PurchaseInfo | null
  /**
   * Check if user has any active paid purchase (amount > 0)
   * Checks purchases with status === 'active'.
   * Backend keeps purchases as 'active' until expiration, even when cancelled.
   */
  hasPaidPurchase: boolean
  /**
   * Most recent active paid purchase (sorted by startDate)
   * Returns purchase with status === 'active' and amount > 0.
   * null if no active paid purchase exists
   */
  activePaidPurchase: PurchaseInfo | null
}

/**
 * SolvaPay Provider Configuration
 * Sensible defaults for minimal code, but fully customizable
 */
export interface BalanceStatus {
  loading: boolean
  credits: number | null
  displayCurrency: string | null
  creditsPerMinorUnit: number | null
  displayExchangeRate: number | null
  refetch: () => Promise<void>
  adjustBalance: (credits: number) => void
}

export interface SolvaPayConfig {
  /**
   * API route configuration
   * Defaults to standard Next.js API routes
   */
  api?: {
    checkPurchase?: string // Default: '/api/check-purchase'
    createPayment?: string // Default: '/api/create-payment-intent'
    processPayment?: string // Default: '/api/process-payment'
    createTopupPayment?: string // Default: '/api/create-topup-payment-intent'
    customerBalance?: string // Default: '/api/customer-balance'
    cancelRenewal?: string // Default: '/api/cancel-renewal'
    reactivateRenewal?: string // Default: '/api/reactivate-renewal'
    activatePlan?: string // Default: '/api/activate-plan'
    listPlans?: string // Default: '/api/list-plans'
    getMerchant?: string // Default: '/api/merchant'
    getProduct?: string // Default: '/api/get-product'
    createCheckoutSession?: string // Default: '/api/create-checkout-session'
    createCustomerSession?: string // Default: '/api/create-customer-session'
    getPaymentMethod?: string // Default: '/api/payment-method'
  }

  /**
   * Data-access transport. Replaces the default HTTP calls with any
   * compatible implementation (e.g. `createMcpAppAdapter(app)` from
   * `@solvapay/react/mcp`). When omitted, the provider builds a default
   * HTTP transport from `config.api` + `config.fetch`.
   */
  transport?: SolvaPayTransport

  /**
   * BCP-47 locale tag (e.g. 'en', 'sv-SE'). Threaded through every SDK
   * component, `Intl.NumberFormat`, and Stripe Elements. Defaults to the
   * runtime default (typically 'en').
   */
  locale?: string

  /**
   * Partial copy overrides. Keys not supplied fall back to the bundled English
   * defaults — consumers only provide the strings they actually want to change.
   */
  copy?: PartialSolvaPayCopy

  /**
   * Authentication configuration
   * Uses adapter pattern for flexible auth provider support
   */
  auth?: {
    /**
     * Auth adapter instance
     * Default: checks localStorage for 'auth_token' key
     *
     * @example
     * ```tsx
     * import { createSupabaseAuthAdapter } from '@solvapay/react-supabase';
     *
     * <SolvaPayProvider
     *   config={{
     *     auth: {
     *       adapter: createSupabaseAuthAdapter({
     *         supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
     *         supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
     *       })
     *     }
     *   }}
     * >
     * ```
     */
    adapter?: AuthAdapter
  }

  /**
   * Custom fetch implementation
   * Default: uses global fetch
   */
  fetch?: typeof fetch

  /**
   * Request headers to include in all API calls
   * Default: empty
   */
  headers?: HeadersInit | (() => Promise<HeadersInit>)

  /**
   * Custom error handler
   * Default: logs to console
   */
  onError?: (error: Error, context: string) => void
}

export interface CancelResult {
  reference?: string
  status?: string
  cancelledAt?: string
  [key: string]: unknown
}

export interface ReactivateResult {
  reference?: string
  status?: string
  [key: string]: unknown
}

export { type ActivatePlanResult, type PaymentMethodInfo }

export interface UsePaymentMethodReturn {
  paymentMethod: PaymentMethodInfo | null
  loading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

export interface SolvaPayContextValue {
  purchase: PurchaseStatus
  refetchPurchase: () => Promise<void>
  createPayment: (params: {
    planRef?: string
    productRef?: string
    customer?: PrefillCustomer
  }) => Promise<PaymentIntentResult>
  processPayment?: (params: {
    paymentIntentId: string
    productRef: string
    planRef?: string
  }) => Promise<ProcessPaymentResult>
  createTopupPayment: (params: {
    amount: number
    currency?: string
  }) => Promise<TopupPaymentResult>
  cancelRenewal: (params: { purchaseRef: string; reason?: string }) => Promise<CancelResult>
  reactivateRenewal: (params: { purchaseRef: string }) => Promise<ReactivateResult>
  activatePlan: (params: {
    productRef: string
    planRef: string
  }) => Promise<ActivatePlanResult>
  customerRef?: string
  updateCustomerRef?: (newCustomerRef: string) => void
  balance: BalanceStatus
  /** @internal Provider config — used by SDK hooks, not part of public API */
  _config?: SolvaPayConfig
}

export interface SolvaPayProviderProps {
  /**
   * Configuration object with sensible defaults.
   *
   * To customise data access (e.g. route through MCP instead of HTTP), pass
   * `config.transport`. Legacy per-method overrides (`createPayment`,
   * `checkPurchase`, `processPayment`, `createTopupPayment`) have been
   * removed in favour of the unified transport surface — see
   * [`SolvaPayTransport`](../transport/types.ts) and
   * `@solvapay/react/mcp` for an MCP implementation.
   */
  config?: SolvaPayConfig

  children: React.ReactNode
}

/**
 * Error type for payment operations
 */
export interface PaymentError extends Error {
  code?: string
  type?: string
}

/**
 * Plan returned by the SolvaPay API.
 *
 * All fields are optional except `reference` so the type stays compatible
 * with partial JSON responses from custom fetcher functions.
 */
export interface Plan {
  type?: 'recurring' | 'one-time' | 'usage-based'
  reference: string
  name?: string
  description?: string
  price?: number
  currency?: string
  currencySymbol?: string
  freeUnits?: number
  setupFee?: number
  trialDays?: number
  billingCycle?: string
  billingModel?: 'pre-paid' | 'post-paid'
  creditsPerUnit?: number
  measures?: string
  limit?: number
  rolloverUnusedUnits?: boolean
  limits?: Record<string, unknown>
  features?: Record<string, unknown> | string[]
  requiresPayment?: boolean
  default?: boolean
  isActive?: boolean
  maxActiveUsers?: number
  accessExpiryDays?: number
  status?: string
  createdAt?: string
  updatedAt?: string
  interval?: string
  metadata?: Record<string, unknown>
}

/**
 * Options for usePlans hook
 */
export interface UsePlansOptions {
  /**
   * Fetcher function to retrieve plans
   */
  fetcher: (productRef: string) => Promise<Plan[]>
  /**
   * Product reference to fetch plans for
   */
  productRef?: string
  /**
   * Optional filter function to filter plans.
   * Receives plan and its index (after sorting, if sortBy is provided).
   */
  filter?: (plan: Plan, index: number) => boolean
  /**
   * Optional sort function to sort plans
   */
  sortBy?: (a: Plan, b: Plan) => number
  /**
   * Auto-select first paid plan on load
   */
  autoSelectFirstPaid?: boolean
  /**
   * Plan reference to select initially when plans load.
   * Applied at most once when selectionReady is true.
   * Takes priority over autoSelectFirstPaid.
   */
  initialPlanRef?: string
  /**
   * When false, plans still fetch but auto-selection is deferred.
   * When it transitions to true, one-shot initial selection fires.
   * Defaults to true.
   */
  selectionReady?: boolean
}

/**
 * Return type for usePlans hook
 */
export interface UsePlansReturn {
  plans: Plan[]
  loading: boolean
  error: Error | null
  selectedPlanIndex: number
  selectedPlan: Plan | null
  setSelectedPlanIndex: (index: number) => void
  selectPlan: (planRef: string) => void
  refetch: () => Promise<void>
  /** True after the one-shot initial selection has been applied */
  isSelectionReady: boolean
}

/**
 * Return type for usePurchaseStatus hook
 *
 * Provides advanced purchase status helpers and utilities.
 * Focuses on cancelled purchase logic and date formatting.
 * For basic purchase data and paid status, use usePurchase() instead.
 */
export interface PurchaseStatusReturn {
  /**
   * Most recent cancelled paid purchase (sorted by startDate)
   * null if no cancelled paid purchase exists
   */
  cancelledPurchase: PurchaseInfo | null
  /**
   * Whether to show cancelled purchase notice
   * true if cancelledPurchase exists
   */
  shouldShowCancelledNotice: boolean
  /**
   * Format a date string to locale format (e.g., "January 15, 2024")
   * Returns null if dateString is not provided
   */
  formatDate: (dateString?: string) => string | null
  /**
   * Calculate days until expiration date
   * Returns null if endDate is not provided, otherwise returns days (0 or positive)
   */
  getDaysUntilExpiration: (endDate?: string) => number | null
}

/**
 * Payment form props - simplified and minimal
 */
/**
 * Discriminated checkout-completion result surfaced by `<PaymentForm>` and
 * `<CheckoutLayout>` via their `onResult` callback. Integrators handling
 * both paid and free plans should use `onResult` to get a single typed
 * callback; paid-only integrators keep using `onSuccess(paymentIntent)`.
 */
export type PaymentResult = { kind: 'paid'; paymentIntent: PaymentIntent }
export type ActivationResult = { kind: 'activated'; result: ActivatePlanResult }
export type CheckoutResult = PaymentResult | ActivationResult

export interface PaymentFormProps {
  /**
   * Plan reference to checkout. When omitted, the SDK auto-resolves the plan from
   * productRef (requires exactly one active plan or a default plan). Pass explicitly
   * when the product has multiple plans without a default.
   */
  planRef?: string
  /**
   * Product reference. Required when planRef is omitted (for plan resolution)
   * and for processing payment after confirmation.
   */
  productRef?: string
  /**
   * Callback when payment succeeds. Fires on paid flows only — preserved
   * exactly for backwards compatibility. Free/activation flows do NOT fire
   * `onSuccess`; use `onResult` to receive both paid and activated results.
   */
  onSuccess?: (paymentIntent: PaymentIntent) => void
  /**
   * Unified callback fired on both paid and activated completions with a
   * discriminated result. Safe to provide alongside `onSuccess` — for paid
   * flows both fire (in order: `onSuccess` first, then `onResult`).
   */
  onResult?: (result: CheckoutResult) => void
  /**
   * Override the default free-plan activation step. When provided, the form
   * awaits this promise on submit and fires `onResult` when it resolves.
   * When omitted, the default behavior calls `activatePlan` from context.
   */
  onFreePlan?: (plan: Plan) => Promise<unknown> | void
  /**
   * Callback when payment fails
   */
  onError?: (error: Error) => void
  /**
   * Return URL after payment completion. Defaults to current page URL if not provided.
   */
  returnUrl?: string
  /**
   * Text for the submit button. Defaults to "Pay Now"
   */
  submitButtonText?: string
  /**
   * Optional className for the form container
   */
  className?: string
  /**
   * Optional className for the submit button
   */
  buttonClassName?: string
  /**
   * Customer name/email to forward to backend PaymentIntent creation so the
   * server-side customer record is authoritative. Echoed back via
   * `useCustomer()` after the intent is created.
   */
  prefillCustomer?: PrefillCustomer
  /**
   * When true, the default tree renders a terms/privacy checkbox and gates
   * the submit button until it is ticked. No-op when custom `children` are
   * passed — compose `<PaymentForm.TermsCheckbox />` yourself.
   */
  requireTermsAcceptance?: boolean
}

export interface UseTopupAmountSelectorOptions {
  currency: string
  minAmount?: number
  maxAmount?: number
}

export interface UseTopupAmountSelectorReturn {
  quickAmounts: number[]
  selectedAmount: number | null
  customAmount: string
  resolvedAmount: number | null
  selectQuickAmount: (amount: number) => void
  setCustomAmount: (value: string) => void
  error: string | null
  validate: () => boolean
  reset: () => void
  currencySymbol: string
}

export type PurchaseStatusValue =
  | 'pending'
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'cancelled'
  | 'expired'
  | 'suspended'
  | 'refunded'
