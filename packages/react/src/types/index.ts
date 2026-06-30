/**
 * TypeScript type definitions for @solvapay/react
 */

import type { PaymentIntent } from '@stripe/stripe-js'
import type {
  ProcessPaymentResult,
  TopupProcessResult,
  ActivatePlanResult,
  PaymentMethodInfo,
  CustomerBalanceResult,
  GetUsageResult,
  PurchaseCheckResult,
} from '@solvapay/server'
import type { AuthAdapter } from '../adapters/auth'
import type { TaxBehavior } from '@solvapay/core'
import type { PartialSolvaPayCopy } from '../i18n/types'
import type { SolvaPayTransport, CreditDisplayBlock } from '../transport/types'

export interface PurchaseInfo {
  reference: string
  productName: string
  productRef?: string
  status: string
  startDate: string
  endDate?: string
  cancelledAt?: string
  cancellationReason?: string
  /** Normalised amount in USD cents (for cross-currency aggregation). */
  amount?: number
  /** Amount in minor units of `currency` — what the customer was actually charged. */
  originalAmount?: number
  currency?: string
  /** Exchange rate used to convert `originalAmount` → `amount` (USD). */
  exchangeRate?: number
  planType?: string
  isRecurring?: boolean
  nextBillingDate?: string
  billingCycle?: string
  planRef?: string
  /** How the purchase was created — `free_default` for auto-enrolled free tiers. */
  origin?: 'paid' | 'free_default' | 'manual' | 'one_time' | 'credit_topup'
  planSnapshot?: {
    reference?: string
    name?: string | null
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
  /**
   * Arbitrary metadata attached to the purchase. `metadata.purpose ===
   * 'credit_topup'` signals a balance top-up rather than a plan purchase;
   * see `isPlanPurchase` / `isTopupPurchase` for classification helpers.
   */
  metadata?: Record<string, unknown>
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
  /**
   * Full set of currencies (including `defaultCurrency`) the customer may
   * pay credit topups in. Surfaced only when the merchant enabled more than
   * one — single-currency merchants leave this undefined and keep today's
   * behavior. Drives the topup currency switcher in the PAYG amount step.
   */
  supportedTopupCurrencies?: string[]
  statementDescriptor?: string
  logoUrl?: string
  /**
   * Absolute URL to a square app icon / logomark. Preferred over
   * `logoUrl` for avatar slots and chrome-strip icons that can't
   * letterbox a landscape mark.
   */
  iconUrl?: string
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
  processorPaymentId?: string
}

export interface UseTopupOptions {
  amount: number
  currency?: string
  autoRecharge?: import('@solvapay/server').AutoRechargeInput
}

export interface UseTopupReturn {
  loading: boolean
  error: Error | null
  stripePromise: Promise<import('@stripe/stripe-js').Stripe | null> | null
  clientSecret: string | null
  processorPaymentId: string | null
  startTopup: () => Promise<void>
  reset: () => void
}

/**
 * Optional context forwarded by `TopupForm` to `onSuccess` when the
 * backend-authoritative topup helper observes the wallet delta. The
 * checkout flow uses `creditsAdded` to bump `balance.adjustBalance`
 * for an instant optimistic UI while `refetchPurchase()` lands.
 * Absent on legacy transports or when the backend's poll budget
 * exhausted before the credit booking was visible.
 */
export interface TopupFormSuccessExtras {
  creditsAdded?: number
}

export interface TopupFormProps {
  amount: number
  currency?: string
  autoRecharge?: import('@solvapay/server').AutoRechargeInput
  /**
   * Fires once the customer is fully credited. `extras.creditsAdded`
   * carries the wallet delta observed by the backend helper's
   * post-success poll, when available. The second argument is
   * optional — legacy consumers ignoring it still compile cleanly.
   */
  onSuccess?: (
    paymentIntent: PaymentIntent,
    extras?: TopupFormSuccessExtras,
  ) => void | Promise<void>
  onError?: (error: Error) => void
  /** Called when the tax breakdown updates after attaching business details. */
  onTaxChange?: (breakdown: import('@solvapay/core').TaxBreakdown) => void
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
  /**
   * Purchases that are not plans — e.g. credit top-ups, and any future
   * balance-transaction purposes the backend introduces. Classified
   * structurally (`planSnapshot == null`) with a belt-and-braces check on
   * `metadata.purpose`. See `isPlanPurchase` / `isTopupPurchase`.
   */
  balanceTransactions: PurchaseInfo[]
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
  /** Backend-computed display block — render verbatim when present. */
  display: CreditDisplayBlock | null
  refetch: () => Promise<void>
  /**
   * Optimistically adjusts the in-memory balance. Does not start auto-recharge
   * reconcile polling — call {@link reconcileAfterUsageDebit} with the server
   * signal after a confirmed usage debit when auto-recharge may apply.
   */
  adjustBalance: (credits: number) => void
  /**
   * Poll for balance increase after a confirmed server-side usage debit when
   * the server reported `autoRecharge.triggered: true`. The backend is the sole
   * authority on threshold evaluation; pass `{ expectIncrease: true }` only when
   * the track-usage response includes that signal.
   */
  reconcileAfterUsageDebit: (opts?: { expectIncrease?: boolean }) => void
}

/**
 * Hydration seed passed by MCP App hosts so `SolvaPayProvider` can mount
 * with cached data instead of firing per-view tool calls. Non-MCP
 * integrators leave this undefined — all current behaviour (fetch on
 * mount, HTTP routes) is preserved.
 */
export interface SolvaPayProviderInitial {
  /** Authenticated customer ref (`customer.ref` from the bootstrap). */
  customerRef: string | null
  purchase: PurchaseCheckResult | null
  paymentMethod: PaymentMethodInfo | null
  balance: CustomerBalanceResult | null
  usage: GetUsageResult | null
  merchant: Merchant
  product: Product
  plans: Plan[]
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
    processTopupPayment?: string // Default: '/api/process-topup-payment'
    attachBusinessDetails?: string // Default: '/api/attach-business-details'
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
    autoRecharge?: string // Default: '/api/auto-recharge'
    getUsage?: string // Default: '/api/usage'
    getLimits?: string // Default: '/api/limits'
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

  /**
   * Pre-fetched seed for MCP App hosts. When provided, the provider
   * mounts with the snapshot already applied — no `checkPurchase`,
   * `getBalance`, `getMerchant`, `getProduct`, `getPlans`, or
   * `getPaymentMethod` calls on first render. Non-MCP integrators leave
   * this undefined; HTTP behaviour is unchanged.
   */
  initial?: SolvaPayProviderInitial

  /**
   * Post-mutation re-fetch for MCP App hosts. When provided, the
   * provider's `refreshBootstrap()` calls this to get a fresh
   * `SolvaPayProviderInitial` snapshot (typically by re-invoking
   * `manage_account` on the host) and re-applies it to provider state
   * and the module caches. Non-MCP integrators leave this undefined —
   * `refreshBootstrap()` falls back to `refetchPurchase()` +
   * `balance.refetch()`. Return `null` to skip the refresh (e.g. when
   * the host is offline).
   */
  refreshInitial?: () => Promise<SolvaPayProviderInitial | null>
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
  /**
   * Synchronously merge a `PurchaseInfo`-shaped row into the provider's
   * `purchases` array. Idempotent on `purchase.reference` so re-fires
   * from a later `refetchPurchase` are no-ops. Runs through the same
   * `filterPurchases` active-row policy as the HTTP and bootstrap
   * paths, so callers can hand in a fresh purchase from
   * `processPaymentIntent` and have consumers (`hasPaidPurchase`,
   * `activePurchase`, …) see it on the next render — no wait for a
   * background refetch to land.
   */
  upsertPurchase: (purchase: PurchaseInfo) => void
  createPayment: (params: {
    planRef?: string
    productRef?: string
    currency?: string
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
    autoRecharge?: import('@solvapay/server').AutoRechargeInput
  }) => Promise<TopupPaymentResult>
  /**
   * Process a credit-topup payment intent after Stripe's `confirmPayment`
   * resolves. Resolves once the backend observes the PI reach
   * `succeeded` AND the webhook handler has booked the credit
   * transaction — eliminates the confirm-to-webhook race that left the
   * customer momentarily uncredited at the moment `TopupForm.onSuccess`
   * fired.
   *
   * Optional: transports that can't run the synchronous round-trip
   * omit this, and `TopupForm.onSuccess` fires immediately on Stripe
   * confirm (legacy behaviour). The default HTTP transport always
   * implements it.
   */
  processTopupPayment?: (params: { paymentIntentId: string }) => Promise<TopupProcessResult>
  attachBusinessDetails?: (params: {
    paymentIntentId: string
    customerRef?: string
    isBusiness: boolean
    businessName?: string
    country?: string
    taxId?: string
    taxIdType?: import('@solvapay/core').TaxIdType
  }) => Promise<{ taxBreakdown: import('@solvapay/core').TaxBreakdown }>
  cancelRenewal: (params: { purchaseRef: string; reason?: string }) => Promise<CancelResult>
  reactivateRenewal: (params: { purchaseRef: string }) => Promise<ReactivateResult>
  activatePlan: (params: { productRef: string; planRef: string }) => Promise<ActivatePlanResult>
  customerRef?: string
  updateCustomerRef?: (newCustomerRef: string) => void
  balance: BalanceStatus
  /**
   * Re-bootstrap the MCP snapshot (customer + product-scoped data).
   * Always callable; on non-MCP transports falls back to
   * `refetchPurchase()` + `balance.refetch()` so every caller can use
   * the same post-mutation hook.
   */
  refreshBootstrap?: () => Promise<void>
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
export interface PlanPricingOption {
  currency: string
  price: number
  basePrice?: number
  setupFee?: number
  default?: boolean
}

export interface Plan {
  type?: 'recurring' | 'one-time' | 'usage-based'
  reference: string
  name?: string
  description?: string
  price?: number
  currency?: string
  pricingOptions?: PlanPricingOption[]
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
  taxBehavior?: TaxBehavior
}

/**
 * Options for usePlans hook
 */
export interface UsePlansOptions {
  /**
   * Fetcher function to retrieve plans.
   *
   * Optional — when omitted, `usePlans` uses `defaultListPlans` which
   * routes through the configured transport (`config.transport.listPlans`)
   * if available, otherwise issues a `GET` to `config.api.listPlans`
   * (default `/api/list-plans`). Provide an explicit `fetcher` only when
   * you need to override that default (custom auth, alternate endpoint,
   * etc.).
   */
  fetcher?: (productRef: string) => Promise<Plan[]>
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
