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

// Hooks
export { useSubscription } from './hooks/useSubscription';
export { useCheckout } from './hooks/useCheckout';
export { useSolvaPay } from './hooks/useSolvaPay';

// Types
export type {
  SolvaPayProviderProps,
  SolvaPayContextValue,
  SubscriptionStatus,
  SubscriptionInfo,
  CustomerSubscriptionData,
  PaymentIntentResult,
  PlanBadgeProps,
  SubscriptionGateProps,
  PaymentFormProps,
  PaymentError,
} from './types';
