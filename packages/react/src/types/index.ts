/**
 * TypeScript type definitions for @solvapay/react
 */

import type { PaymentIntent } from '@stripe/stripe-js';
import type { ProcessPaymentResult } from '@solvapay/server';
import type { AuthAdapter } from '../adapters/auth';

export interface SubscriptionInfo {
  reference: string;
  planName: string;
  agentName: string;
  status: string;
  startDate: string;
  endDate?: string;
  cancelledAt?: string;
  cancellationReason?: string;
  amount?: number;
}

export interface CustomerSubscriptionData {
  customerRef?: string;
  email?: string;
  name?: string;
  subscriptions: SubscriptionInfo[];
}

export interface PaymentIntentResult {
  clientSecret: string;
  publishableKey: string;
  accountId?: string;
  customerRef?: string; // Backend customer reference
}

export interface SubscriptionStatus {
  loading: boolean;
  customerRef?: string;
  email?: string;
  name?: string;
  subscriptions: SubscriptionInfo[];
  hasPlan: (planName: string) => boolean;
  /**
   * Primary active subscription (paid or free) - most recent subscription with status === 'active'
   * Backend keeps subscriptions as 'active' until expiration, even when cancelled.
   * null if no active subscription exists
   */
  activeSubscription: SubscriptionInfo | null;
  /**
   * Check if user has any active paid subscription (amount > 0)
   * Checks subscriptions with status === 'active'.
   * Backend keeps subscriptions as 'active' until expiration, even when cancelled.
   */
  hasPaidSubscription: boolean;
  /**
   * Most recent active paid subscription (sorted by startDate)
   * Returns subscription with status === 'active' and amount > 0.
   * null if no active paid subscription exists
   */
  activePaidSubscription: SubscriptionInfo | null;
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
    checkSubscription?: string;  // Default: '/api/check-subscription'
    createPayment?: string;       // Default: '/api/create-payment-intent'
    processPayment?: string;      // Default: '/api/process-payment'
  };
  
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
    adapter?: AuthAdapter;
    
    /**
     * @deprecated Use `adapter` instead. Will be removed in a future version.
     * Function to get auth token
     */
    getToken?: () => Promise<string | null>;
    
    /**
     * @deprecated Use `adapter` instead. Will be removed in a future version.
     * Function to get user ID (for cache key)
     */
    getUserId?: () => Promise<string | null>;
  };
  
  /**
   * Custom fetch implementation
   * Default: uses global fetch
   */
  fetch?: typeof fetch;
  
  /**
   * Request headers to include in all API calls
   * Default: empty
   */
  headers?: HeadersInit | (() => Promise<HeadersInit>);
  
  /**
   * Custom error handler
   * Default: logs to console
   */
  onError?: (error: Error, context: string) => void;
}

export interface SolvaPayContextValue {
  subscription: SubscriptionStatus;
  refetchSubscription: () => Promise<void>;
  createPayment: (params: { planRef: string; agentRef?: string }) => Promise<PaymentIntentResult>;
  processPayment?: (params: {
    paymentIntentId: string;
    agentRef: string;
    planRef?: string;
  }) => Promise<ProcessPaymentResult>;
  customerRef?: string;
  updateCustomerRef?: (newCustomerRef: string) => void;
}

export interface SolvaPayProviderProps {
  /**
   * Configuration object with sensible defaults
   * If not provided, uses standard Next.js API routes
   */
  config?: SolvaPayConfig;
  
  /**
   * Custom API functions (override config defaults)
   * Use only if you need custom logic beyond standard API routes
   */
  createPayment?: (params: { planRef: string; agentRef?: string }) => Promise<PaymentIntentResult>;
  checkSubscription?: () => Promise<CustomerSubscriptionData>;
  processPayment?: (params: {
    paymentIntentId: string;
    agentRef: string;
    planRef?: string;
  }) => Promise<ProcessPaymentResult>;
  
  children: React.ReactNode;
}

export interface PlanBadgeProps {
  children?: (props: {
    subscriptions: SubscriptionInfo[];
    loading: boolean;
    displayPlan: string | null;
    shouldShow: boolean;
  }) => React.ReactNode;
  as?: React.ElementType;
  className?: string | ((props: { subscriptions: SubscriptionInfo[] }) => string);
}

export interface SubscriptionGateProps {
  requirePlan?: string;
  children: (props: {
    hasAccess: boolean;
    subscriptions: SubscriptionInfo[];
    loading: boolean;
  }) => React.ReactNode;
}

/**
 * Error type for payment operations
 */
export interface PaymentError extends Error {
  code?: string;
  type?: string;
}

/**
 * Plan interface for subscription plans
 */
export interface Plan {
  reference: string;
  name: string;
  description?: string;
  price?: number;
  currency?: string;
  interval?: string;
  features?: string[];
  isFreeTier?: boolean;
  metadata?: Record<string, any>;
}

/**
 * Options for usePlans hook
 */
export interface UsePlansOptions {
  /**
   * Fetcher function to retrieve plans
   */
  fetcher: (agentRef: string) => Promise<Plan[]>;
  /**
   * Agent reference to fetch plans for
   */
  agentRef?: string;
  /**
   * Optional filter function to filter plans
   */
  filter?: (plan: Plan) => boolean;
  /**
   * Optional sort function to sort plans
   */
  sortBy?: (a: Plan, b: Plan) => number;
  /**
   * Auto-select first paid plan on load
   */
  autoSelectFirstPaid?: boolean;
}

/**
 * Return type for usePlans hook
 */
export interface UsePlansReturn {
  plans: Plan[];
  loading: boolean;
  error: Error | null;
  selectedPlanIndex: number;
  selectedPlan: Plan | null;
  setSelectedPlanIndex: (index: number) => void;
  selectPlan: (planRef: string) => void;
  refetch: () => Promise<void>;
}

/**
 * Props for headless PlanSelector component
 */
export interface PlanSelectorProps {
  /**
   * Agent reference to fetch plans for
   */
  agentRef?: string;
  /**
   * Fetcher function to retrieve plans
   */
  fetcher: (agentRef: string) => Promise<Plan[]>;
  /**
   * Optional filter function
   */
  filter?: (plan: Plan) => boolean;
  /**
   * Optional sort function
   */
  sortBy?: (a: Plan, b: Plan) => number;
  /**
   * Auto-select first paid plan on load
   */
  autoSelectFirstPaid?: boolean;
  /**
   * Render prop function
   */
  children: (props: UsePlansReturn & {
    subscriptions: SubscriptionInfo[];
    isPaidPlan: (planName: string) => boolean;
    isCurrentPlan: (planName: string) => boolean;
  }) => React.ReactNode;
}

/**
 * Return type for useSubscriptionStatus hook
 * 
 * Provides advanced subscription status helpers and utilities.
 * Focuses on cancelled subscription logic and date formatting.
 * For basic subscription data and paid status, use useSubscription() instead.
 */
export interface SubscriptionStatusReturn {
  /**
   * Most recent cancelled paid subscription (sorted by startDate)
   * null if no cancelled paid subscription exists
   */
  cancelledSubscription: SubscriptionInfo | null;
  /**
   * Whether to show cancelled subscription notice
   * true if cancelledSubscription exists
   */
  shouldShowCancelledNotice: boolean;
  /**
   * Format a date string to locale format (e.g., "January 15, 2024")
   * Returns null if dateString is not provided
   */
  formatDate: (dateString?: string) => string | null;
  /**
   * Calculate days until expiration date
   * Returns null if endDate is not provided, otherwise returns days (0 or positive)
   */
  getDaysUntilExpiration: (endDate?: string) => number | null;
}

/**
 * Payment form props - simplified and minimal
 */
export interface PaymentFormProps {
  /**
   * Plan reference to checkout. PaymentForm handles the entire checkout flow internally
   * including Stripe initialization and payment intent creation.
   */
  planRef: string;
  /**
   * Agent reference. Required for processing payment after confirmation.
   */
  agentRef?: string;
  /**
   * Callback when payment succeeds
   */
  onSuccess?: (paymentIntent: PaymentIntent) => void;
  /**
   * Callback when payment fails
   */
  onError?: (error: Error) => void;
  /**
   * Return URL after payment completion. Defaults to current page URL if not provided.
   */
  returnUrl?: string;
  /**
   * Text for the submit button. Defaults to "Pay Now"
   */
  submitButtonText?: string;
  /**
   * Optional className for the form container
   */
  className?: string;
  /**
   * Optional className for the submit button
   */
  buttonClassName?: string;
}
