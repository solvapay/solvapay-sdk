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
export { PricingSelector } from './components/PricingSelector'
export { Spinner } from './components/Spinner'
export { StripePaymentFormWrapper } from './components/StripePaymentFormWrapper'
export { BalanceBadge } from './components/BalanceBadge'
export { CheckoutSummary } from './components/CheckoutSummary'
export { MandateText } from './components/MandateText'
export { CheckoutLayout } from './components/CheckoutLayout'

// Styled-default components (checkout composition)
export { PlanSelector } from './components/PlanSelector'
export { AmountPicker } from './components/AmountPicker'
export { ActivationFlow } from './components/ActivationFlow'
export { CancelPlanButton } from './components/CancelPlanButton'
export { CancelledPlanNotice } from './components/CancelledPlanNotice'
export { CreditGate } from './components/CreditGate'
export {
  PaymentFormContext,
  usePaymentForm,
  PaymentFormProvider,
} from './components/PaymentFormContext'
export type {
  PaymentFormContextValue,
  PaymentElementKind,
} from './components/PaymentFormContext'

// Hooks
export { usePurchase } from './hooks/usePurchase'
export { useCustomer } from './hooks/useCustomer'
export { useCheckout } from './hooks/useCheckout'
export { useSolvaPay } from './hooks/useSolvaPay'
export { usePlans } from './hooks/usePlans'
export { usePlan } from './hooks/usePlan'
export { useProduct } from './hooks/useProduct'
export { useMerchant } from './hooks/useMerchant'
export { useCopy, useLocale } from './hooks/useCopy'
export { usePurchaseStatus } from './hooks/usePurchaseStatus'
export { usePurchaseActions } from './hooks/usePurchaseActions'
export { useActivation } from './hooks/useActivation'
export { useTopup } from './hooks/useTopup'
export { useBalance } from './hooks/useBalance'
export { useTopupAmountSelector } from './hooks/useTopupAmountSelector'

// i18n primitives (for consumers who want to author copy bundles or mount
// CopyProvider independently of SolvaPayProvider)
export { CopyProvider, CopyContext } from './i18n/context'
export { enCopy } from './i18n/en'
export { interpolate } from './i18n/interpolate'
export { mergeCopy } from './i18n/merge'
export type {
  SolvaPayCopy,
  PartialSolvaPayCopy,
  MandateContext,
  MandateTemplate,
} from './i18n/types'

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
  PaymentFormProps,
  CheckoutResult,
  PaymentResult,
  ActivationResult,
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
  BalanceStatus,
  BalanceBadgeProps,
  CancelResult,
  ReactivateResult,
  ActivatePlanResult,
  UseTopupAmountSelectorOptions,
  UseTopupAmountSelectorReturn,
  Merchant,
  UseMerchantReturn,
  Product,
  UseProductReturn,
  UsePlanOptions,
  UsePlanReturn,
  PrefillCustomer,
} from './types'
export type { PurchaseActions } from './hooks/usePurchaseActions'
export type { UseActivationReturn, ActivationState } from './hooks/useActivation'
export type { CustomerInfo } from './hooks/useCustomer'
export type { CheckoutSummaryProps } from './components/CheckoutSummary'
export type { MandateTextProps } from './components/MandateText'
export type {
  CheckoutLayoutProps,
  CheckoutLayoutSize,
  CheckoutLayoutPlanSelectorOptions,
} from './components/CheckoutLayout'
export type { PlanSelectorProps } from './components/PlanSelector'
export type {
  AmountPickerProps,
  AmountPickerClassNames,
  AmountPickerRenderArgs,
} from './components/AmountPicker'
export type {
  ActivationFlowProps,
  ActivationFlowClassNames,
  ActivationFlowRenderArgs,
  ActivationFlowStep,
} from './components/ActivationFlow'
export type {
  CancelPlanButtonProps,
  CancelPlanButtonClassNames,
  CancelPlanButtonRenderArgs,
} from './components/CancelPlanButton'
export type {
  CancelledPlanNoticeProps,
  CancelledPlanNoticeClassNames,
  CancelledPlanNoticeRenderArgs,
} from './components/CancelledPlanNotice'
export type {
  CreditGateProps,
  CreditGateRenderArgs,
} from './components/CreditGate'
export type { CheckoutVariant } from './utils/checkoutVariant'

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
export { formatPrice } from './utils/format'
export type { FormatPriceOptions } from './utils/format'
export { deriveVariant } from './utils/checkoutVariant'
export { resolveCta } from './utils/checkoutCta'
export { confirmPayment } from './utils/confirmPayment'
export type {
  ConfirmPaymentMode,
  ConfirmPaymentInput,
  ConfirmPaymentResult,
} from './utils/confirmPayment'
