/**
 * TypeScript type definitions for @solvapay/react
 */

import type { PaymentIntent } from '@stripe/stripe-js'
import type { ProcessPaymentResult } from '@solvapay/server'
import type { AuthAdapter } from '../adapters/auth'

export interface PurchaseInfo {
  reference: string
  planName: string
  agentName: string
  status: string
  startDate: string
  endDate?: string
  cancelledAt?: string
  cancellationReason?: string
  amount?: number
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

export interface PurchaseStatus {
  loading: boolean
  customerRef?: string
  email?: string
  name?: string
  purchases: PurchaseInfo[]
  hasPlan: (planName: string) => boolean
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
export interface SolvaPayConfig {
  /**
   * API route configuration
   * Defaults to standard Next.js API routes
   */
  api?: {
    checkPurchase?: string // Default: '/api/check-purchase'
    createPayment?: string // Default: '/api/create-payment-intent'
    processPayment?: string // Default: '/api/process-payment'
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

export interface SolvaPayContextValue {
  purchase: PurchaseStatus
  refetchPurchase: () => Promise<void>
  createPayment: (params: { planRef: string; agentRef?: string }) => Promise<PaymentIntentResult>
  processPayment?: (params: {
    paymentIntentId: string
    agentRef: string
    planRef?: string
  }) => Promise<ProcessPaymentResult>
  customerRef?: string
  updateCustomerRef?: (newCustomerRef: string) => void
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
  createPayment?: (params: { planRef: string; agentRef?: string }) => Promise<PaymentIntentResult>
  checkPurchase?: () => Promise<CustomerPurchaseData>
  processPayment?: (params: {
    paymentIntentId: string
    agentRef: string
    planRef?: string
  }) => Promise<ProcessPaymentResult>

  children: React.ReactNode
}

export interface PlanBadgeProps {
  children?: (props: {
    purchases: PurchaseInfo[]
    loading: boolean
    displayPlan: string | null
    shouldShow: boolean
  }) => React.ReactNode
  as?: React.ElementType
  className?: string | ((props: { purchases: PurchaseInfo[] }) => string)
}

export interface PurchaseGateProps {
  requirePlan?: string
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
 * Plan interface for purchase plans
 */
export interface Plan {
  reference: string
  name: string
  description?: string
  price?: number
  currency?: string
  interval?: string
  features?: string[]
  isFreeTier?: boolean
  metadata?: Record<string, unknown>
}

/**
 * Options for usePlans hook
 */
export interface UsePlansOptions {
  /**
   * Fetcher function to retrieve plans
   */
  fetcher: (agentRef: string) => Promise<Plan[]>
  /**
   * Agent reference to fetch plans for
   */
  agentRef?: string
  /**
   * Optional filter function to filter plans
   */
  filter?: (plan: Plan) => boolean
  /**
   * Optional sort function to sort plans
   */
  sortBy?: (a: Plan, b: Plan) => number
  /**
   * Auto-select first paid plan on load
   */
  autoSelectFirstPaid?: boolean
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
}

/**
 * Props for headless PlanSelector component
 */
export interface PlanSelectorProps {
  /**
   * Agent reference to fetch plans for
   */
  agentRef?: string
  /**
   * Fetcher function to retrieve plans
   */
  fetcher: (agentRef: string) => Promise<Plan[]>
  /**
   * Optional filter function
   */
  filter?: (plan: Plan) => boolean
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
      isPaidPlan: (planName: string) => boolean
      isCurrentPlan: (planName: string) => boolean
    },
  ) => React.ReactNode
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
export interface PaymentFormProps {
  /**
   * Plan reference to checkout. PaymentForm handles the entire checkout flow internally
   * including Stripe initialization and payment intent creation.
   */
  planRef: string
  /**
   * Agent reference. Required for processing payment after confirmation.
   */
  agentRef?: string
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
