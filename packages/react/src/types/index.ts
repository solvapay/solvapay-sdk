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
 * Payment form props with proper Stripe types
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
  onSuccess?: (paymentIntent: PaymentIntent) => void;
  onError?: (error: Error) => void;
  /**
   * Return URL after payment completion. Defaults to current page URL if not provided.
   */
  returnUrl?: string;
  submitButtonText?: string;
  /**
   * Optional className for the form container (wraps form, messages, and cancel button)
   */
  className?: string;
  /**
   * Optional className for the submit button
   */
  buttonClassName?: string;
  /**
   * Text for the initial checkout button. If provided, shows a button first instead of
   * auto-starting checkout.
   */
  initialButtonText?: string;
  /**
   * Text for the cancel button. Set to empty string to hide cancel button.
   */
  cancelButtonText?: string;
}
