/**
 * @solvapay/react - Payment components for SolvaPay
 * 
 * Provides headless React components and hooks for handling payment flows.
 */

// Core Provider
export { SolvaPayProvider } from './SolvaPayProvider';

// Payment Form
export { PaymentForm } from './PaymentForm';

// Headless Components
export { PlanBadge } from './components/PlanBadge';
export { SubscriptionGate } from './components/SubscriptionGate';
export { PlanSelector } from './components/PlanSelector';
export { Spinner } from './components/Spinner';
export { StripePaymentFormWrapper } from './components/StripePaymentFormWrapper';

// Hooks
export { useSubscription } from './hooks/useSubscription';
export { useCheckout } from './hooks/useCheckout';
export { useSolvaPay } from './hooks/useSolvaPay';
export { usePlans } from './hooks/usePlans';
export { useSubscriptionStatus } from './hooks/useSubscriptionStatus';

// Types
export type {
  SolvaPayConfig,
  SolvaPayProviderProps,
  SolvaPayContextValue,
  SubscriptionStatus,
  SubscriptionInfo,
  CustomerSubscriptionData,
  PaymentIntentResult,
  PlanBadgeProps,
  SubscriptionGateProps,
  PlanSelectorProps,
  PaymentFormProps,
  PaymentError,
  Plan,
  UsePlansOptions,
  UsePlansReturn,
  SubscriptionStatusReturn,
} from './types';

// Adapters
export type { AuthAdapter } from './adapters/auth';
export { defaultAuthAdapter } from './adapters/auth';

// Utilities
export {
  filterSubscriptions,
  getActiveSubscriptions,
  getCancelledSubscriptionsWithEndDate,
  getMostRecentSubscription,
  getPrimarySubscription,
  hasActivePaidSubscription,
} from './utils/subscriptions';
