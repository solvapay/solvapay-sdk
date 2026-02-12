/**
 * @solvapay/react - Payment components for SolvaPay
 *
 * Provides headless React components and hooks for handling payment flows.
 */

// Core Provider
export { SolvaPayProvider } from './SolvaPayProvider'

// Payment Form
export { PaymentForm } from './PaymentForm'

// Headless Components
export { PlanBadge } from './components/PlanBadge'
export { PurchaseGate } from './components/PurchaseGate'
export { PlanSelector } from './components/PlanSelector'
export { Spinner } from './components/Spinner'
export { StripePaymentFormWrapper } from './components/StripePaymentFormWrapper'

// Hooks
export { usePurchase } from './hooks/usePurchase'
export { useCustomer } from './hooks/useCustomer'
export { useCheckout } from './hooks/useCheckout'
export { useSolvaPay } from './hooks/useSolvaPay'
export { usePlans } from './hooks/usePlans'
export { usePurchaseStatus } from './hooks/usePurchaseStatus'

// Types
export type {
  SolvaPayConfig,
  SolvaPayProviderProps,
  SolvaPayContextValue,
  PurchaseStatus,
  PurchaseInfo,
  CustomerPurchaseData,
  PaymentIntentResult,
  PlanBadgeProps,
  PurchaseGateProps,
  PlanSelectorProps,
  PaymentFormProps,
  PaymentError,
  Plan,
  UsePlansOptions,
  UsePlansReturn,
  PurchaseStatusReturn,
} from './types'
export type { CustomerInfo } from './hooks/useCustomer'

// Adapters
export type { AuthAdapter } from './adapters/auth'
export { defaultAuthAdapter } from './adapters/auth'

// Utilities
export {
  filterPurchases,
  getActivePurchases,
  getCancelledPurchasesWithEndDate,
  getMostRecentPurchase,
  getPrimaryPurchase,
  isPaidPurchase,
} from './utils/purchases'
