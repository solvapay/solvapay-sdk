/**
 * TypeScript type definitions for @solvapay/react
 */

import type { PaymentIntent } from '@stripe/stripe-js';
import type { ProcessPaymentResult } from '@solvapay/server';

export interface SubscriptionInfo {
  reference: string;
  planName: string;
  agentName: string;
  status: string;
  startDate: string;
  endDate?: string;
  cancelledAt?: string;
  cancellationReason?: string;
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
  hasActiveSubscription: boolean;
  hasPlan: (planName: string) => boolean;
}

export interface SolvaPayContextValue {
  subscription: SubscriptionStatus;
  refetchSubscription: () => Promise<void>;
  createPayment: (params: { planRef: string; customerRef: string }) => Promise<PaymentIntentResult>;
  processPayment?: (params: {
    paymentIntentId: string;
    agentRef: string;
    customerRef: string;
    planRef?: string;
  }) => Promise<ProcessPaymentResult>;
  customerRef?: string;
  updateCustomerRef?: (newCustomerRef: string) => void;
}

export interface SolvaPayProviderProps {
  createPayment: (params: { planRef: string; customerRef: string }) => Promise<PaymentIntentResult>;
  checkSubscription: (customerRef: string) => Promise<CustomerSubscriptionData>;
  processPayment?: (params: {
    paymentIntentId: string;
    agentRef: string;
    customerRef: string;
    planRef?: string;
  }) => Promise<ProcessPaymentResult>;
  customerRef?: string;
  onCustomerRefUpdate?: (newCustomerRef: string) => void;
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
 * Return type for useSubscriptionHelpers hook
 */
export interface SubscriptionHelpersReturn {
  /**
   * Check if a plan name is a paid plan
   */
  isPaidPlan: (planName: string) => boolean;
  /**
   * Get active paid subscription
   */
  activePaidSubscription: SubscriptionInfo | null;
  /**
   * Get cancelled subscription
   */
  cancelledSubscription: SubscriptionInfo | null;
  /**
   * Check if user has any paid subscription
   */
  hasPaidSubscription: boolean;
  /**
   * Check if should show cancelled notice
   */
  shouldShowCancelledNotice: boolean;
  /**
   * Get active plan name
   */
  activePlanName: string | null;
  /**
   * Format a date string
   */
  formatDate: (dateString?: string) => string | null;
  /**
   * Get days until a date
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
