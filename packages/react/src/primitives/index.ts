/**
 * @solvapay/react/primitives
 *
 * Unstyled, compound primitives with `asChild` composition, `data-state`
 * attributes, and opaque `data-solvapay-*` selectors. Consumer apps use
 * these to build fully custom checkout UIs; the default tree at
 * `@solvapay/react` is a thin shim over these primitives.
 */

export { Slot, Slottable } from './slot'
export { composeRefs, setRef } from './composeRefs'
export { composeEventHandlers } from './composeEventHandlers'

export {
  CheckoutSummary,
  CheckoutSummaryRoot,
  CheckoutSummaryProduct,
  CheckoutSummaryPlan,
  CheckoutSummaryPrice,
  CheckoutSummaryTrial,
  CheckoutSummaryTaxNote,
  useCheckoutSummary,
} from './CheckoutSummary'

export {
  PlanSelector,
  PlanSelectorRoot,
  PlanSelectorHeading,
  PlanSelectorGrid,
  PlanSelectorCard,
  PlanSelectorCardName,
  PlanSelectorCardPrice,
  PlanSelectorCardInterval,
  PlanSelectorCardBadge,
  PlanSelectorLoading,
  PlanSelectorError,
  usePlanSelector,
} from './PlanSelector'

export {
  PaymentForm,
  PaymentFormRoot,
  PaymentFormSummary,
  PaymentFormCustomerFields,
  PaymentFormPaymentElement,
  PaymentFormCardElement,
  PaymentFormMandateText,
  PaymentFormTermsCheckbox,
  PaymentFormSubmitButton,
  PaymentFormLoading,
  PaymentFormError,
} from './PaymentForm'

export {
  ActivationFlow,
  ActivationFlowRoot,
  ActivationFlowSummary,
  ActivationFlowActivateButton,
  ActivationFlowAmountPicker,
  ActivationFlowContinueButton,
  ActivationFlowRetrying,
  ActivationFlowActivated,
  ActivationFlowLoading,
  ActivationFlowError,
  useActivationFlow,
} from './ActivationFlow'
export type { ActivationFlowStep } from './ActivationFlow'

export {
  AmountPicker,
  AmountPickerRoot,
  AmountPickerOption,
  AmountPickerCustom,
  AmountPickerConfirm,
  useAmountPicker,
  useAmountPickerCopy,
} from './AmountPicker'

export {
  BalanceBadge,
} from './BalanceBadge'

export {
  CancelPlanButton,
} from './CancelPlanButton'

export {
  CancelledPlanNotice,
  CancelledPlanNoticeRoot,
  CancelledPlanNoticeHeading,
  CancelledPlanNoticeExpires,
  CancelledPlanNoticeDaysRemaining,
  CancelledPlanNoticeAccessUntil,
  CancelledPlanNoticeCancelledOn,
  CancelledPlanNoticeReason,
  CancelledPlanNoticeReactivateButton,
  useCancelledPlanNotice,
} from './CancelledPlanNotice'

export {
  CreditGate,
  CreditGateRoot,
  CreditGateHeading,
  CreditGateSubheading,
  CreditGateTopup,
  CreditGateLoading,
  CreditGateError,
  useCreditGate,
} from './CreditGate'

export {
  PurchaseGate,
  PurchaseGateRoot,
  PurchaseGateAllowed,
  PurchaseGateBlocked,
  PurchaseGateLoading,
  PurchaseGateError,
  usePurchaseGate,
} from './PurchaseGate'

export {
  TopupForm,
  TopupFormRoot,
  TopupFormPaymentElement,
  TopupFormSubmitButton,
  TopupFormLoading,
  TopupFormError,
  useTopupForm,
} from './TopupForm'

export {
  MandateText,
} from './MandateText'
export type { MandateTextProps } from './MandateText'

export {
  ProductBadge,
  PlanBadge,
} from './ProductBadge'
