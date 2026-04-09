/**
 * TypeScript type definitions for @solvapay/react
 */

import type { PaymentIntent } from '@stripe/stripe-js'
import type { ProcessPaymentResult, ActivatePlanResult } from '@solvapay/server'
import type { AuthAdapter } from '../adapters/auth'

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
  /** @deprecated Use hasProduct instead */
  hasPlan: (productName: string) => boolean
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
  }

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

    /**
     * @deprecated Use `adapter` instead. Will be removed in a future version.
     * Function to get auth token
     */
    getToken?: () => Promise<string | null>

    /**
     * @deprecated Use `adapter` instead. Will be removed in a future version.
     * Function to get user ID (for cache key)
     */
    getUserId?: () => Promise<string | null>
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

export { type ActivatePlanResult }

export interface SolvaPayContextValue {
  purchase: PurchaseStatus
  refetchPurchase: () => Promise<void>
  createPayment: (params: { planRef?: string; productRef?: string }) => Promise<PaymentIntentResult>
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
   * Configuration object with sensible defaults
   * If not provided, uses standard Next.js API routes
   */
  config?: SolvaPayConfig

  /**
   * Custom API functions (override config defaults)
   * Use only if you need custom logic beyond standard API routes
   */
  createPayment?: (params: { planRef?: string; productRef?: string }) => Promise<PaymentIntentResult>
  checkPurchase?: () => Promise<CustomerPurchaseData>
  processPayment?: (params: {
    paymentIntentId: string
    productRef: string
    planRef?: string
  }) => Promise<ProcessPaymentResult>
  createTopupPayment?: (params: {
    amount: number
    currency?: string
  }) => Promise<TopupPaymentResult>

  children: React.ReactNode
}

export interface ProductBadgeProps {
  children?: (props: {
    purchases: PurchaseInfo[]
    loading: boolean
    displayPlan: string | null
    shouldShow: boolean
  }) => React.ReactNode
  as?: React.ElementType
  className?: string | ((props: { purchases: PurchaseInfo[] }) => string)
}

/** @deprecated Use ProductBadgeProps instead */
export type PlanBadgeProps = ProductBadgeProps

export interface PurchaseGateProps {
  /** @deprecated Use requireProduct instead */
  requirePlan?: string
  requireProduct?: string
  children: (props: {
    hasAccess: boolean
    purchases: PurchaseInfo[]
    loading: boolean
  }) => React.ReactNode
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
 * Props for headless PricingSelector component
 */
export interface PricingSelectorProps {
  /**
   * Product reference to fetch plans for
   */
  productRef?: string
  /**
   * Fetcher function to retrieve plans
   */
  fetcher: (productRef: string) => Promise<Plan[]>
  /**
   * Optional filter function
   */
  filter?: (plan: Plan, index: number) => boolean
  /**
   * Optional sort function
   */
  sortBy?: (a: Plan, b: Plan) => number
  /**
   * Auto-select first paid plan on load
   */
  autoSelectFirstPaid?: boolean
  /**
   * Render prop function
   */
  children: (
    props: UsePlansReturn & {
      purchases: PurchaseInfo[]
      isPaidPlan: (planRef: string) => boolean
      isCurrentPlan: (planRef: string) => boolean
    },
  ) => React.ReactNode
}

/** @deprecated Use PricingSelectorProps instead */
export type PlanSelectorProps = PricingSelectorProps

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
   * Callback when payment succeeds
   */
  onSuccess?: (paymentIntent: PaymentIntent) => void
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
}

export interface BalanceBadgeProps {
  className?: string
  numberOnly?: boolean
  children?: (props: {
    credits: number | null
    loading: boolean
    displayCurrency: string | null
    creditsPerMinorUnit: number | null
  }) => React.ReactNode
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
