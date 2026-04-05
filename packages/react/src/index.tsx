/**
 * @solvapay/react - Payment components for SolvaPay
 *
 * Provides headless React components and hooks for handling payment flows.
 */

// Core Provider
export { SolvaPayProvider } from './SolvaPayProvider'

// Payment Form
export { PaymentForm } from './PaymentForm'
export { TopupForm } from './TopupForm'

// Headless Components
export { ProductBadge, PlanBadge } from './components/ProductBadge'
export { PurchaseGate } from './components/PurchaseGate'
export { PricingSelector, PlanSelector } from './components/PricingSelector'
export { Spinner } from './components/Spinner'
export { StripePaymentFormWrapper } from './components/StripePaymentFormWrapper'
export { BalanceBadge } from './components/BalanceBadge'

// Hooks
export { usePurchase } from './hooks/usePurchase'
export { useCustomer } from './hooks/useCustomer'
export { useCheckout } from './hooks/useCheckout'
export { useSolvaPay } from './hooks/useSolvaPay'
export { usePlans } from './hooks/usePlans'
export { usePurchaseStatus } from './hooks/usePurchaseStatus'
export { useTopup } from './hooks/useTopup'
export { useBalance } from './hooks/useBalance'

// Types
export type {
  SolvaPayConfig,
  SolvaPayProviderProps,
  SolvaPayContextValue,
  PurchaseStatus,
  PurchaseInfo,
  CustomerPurchaseData,
  PaymentIntentResult,
  ProductBadgeProps,
  PlanBadgeProps,
  PurchaseGateProps,
  PricingSelectorProps,
  PlanSelectorProps,
  PaymentFormProps,
  PaymentError,
  Plan,
  UsePlansOptions,
  UsePlansReturn,
  PurchaseStatusReturn,
  PurchaseStatusValue,
  TopupFormProps,
  TopupPaymentResult,
  UseTopupOptions,
  UseTopupReturn,
  CreditBalance,
  BalanceStatus,
  BalanceBadgeProps,
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
