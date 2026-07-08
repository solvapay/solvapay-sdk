/**
 * Compile-only types-surface fixture.
 *
 * Exercises every primitive + subcomponent exported from
 * `@solvapay/react/primitives` by deriving its Props via
 * `React.ComponentProps<typeof X>`. Fails `tsc --noEmit` the moment a public
 * export becomes implicitly `any`, goes missing, or loses its Props shape.
 *
 * Runs via `npm run test:types` using `__tests__/tsconfig.types.json`, which
 * resolves the package subpath through a `paths` mapping back to the source
 * primitives barrel.
 */

import type { ComponentProps } from 'react'
import type {
  CheckoutSummary,
  CheckoutSummaryRoot,
  CheckoutSummaryProduct,
  CheckoutSummaryPlan,
  CheckoutSummaryPrice,
  CheckoutSummaryTrial,
  CheckoutSummaryTaxNote,
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
  ActivationFlowStep,
  AmountPicker,
  AmountPickerRoot,
  AmountPickerOption,
  AmountPickerCustom,
  AmountPickerConfirm,
  BalanceBadge,
  CancelPlanButton,
  CancelledPlanNotice,
  CancelledPlanNoticeRoot,
  CancelledPlanNoticeHeading,
  CancelledPlanNoticeExpires,
  CancelledPlanNoticeDaysRemaining,
  CancelledPlanNoticeAccessUntil,
  CancelledPlanNoticeCancelledOn,
  CancelledPlanNoticeReason,
  CancelledPlanNoticeReactivateButton,
  CreditGate,
  CreditGateRoot,
  CreditGateHeading,
  CreditGateSubheading,
  CreditGateTopup,
  CreditGateLoading,
  CreditGateError,
  PurchaseGate,
  PurchaseGateRoot,
  PurchaseGateAllowed,
  PurchaseGateBlocked,
  PurchaseGateLoading,
  PurchaseGateError,
  TopupForm,
  TopupFormRoot,
  TopupFormPaymentElement,
  TopupFormSubmitButton,
  TopupFormLoading,
  TopupFormError,
  MandateText,
  MandateTextProps,
  ProductBadge,
  PlanBadge,
  Slot,
  Slottable,
} from '@solvapay/react/primitives'

// Compile-only assertions. Compound primitives (`CheckoutSummary`,
// `PlanSelector`, ...) are object namespaces that group subcomponents; their
// Props live on the `.Root` subcomponent, so we verify the compound object
// has the expected subcomponent keys *and* probe `Root`'s Props via
// `ComponentProps`. Leaf primitives (`BalanceBadge`, `CancelPlanButton`,
// `MandateText`, `ProductBadge`, `PlanBadge`) are direct components, so
// `ComponentProps<typeof Leaf>` applies directly.

type CompoundShape<T, K extends keyof T> = Pick<T, K>

type _CheckoutSummaryShape = CompoundShape<
  typeof CheckoutSummary,
  'Root' | 'Product' | 'Plan' | 'Price' | 'Trial' | 'TaxNote'
>
const _CheckoutSummaryRoot: ComponentProps<typeof CheckoutSummaryRoot> =
  null as unknown as ComponentProps<typeof CheckoutSummaryRoot>
const _CheckoutSummaryProduct: ComponentProps<typeof CheckoutSummaryProduct> =
  null as unknown as ComponentProps<typeof CheckoutSummaryProduct>
const _CheckoutSummaryPlan: ComponentProps<typeof CheckoutSummaryPlan> =
  null as unknown as ComponentProps<typeof CheckoutSummaryPlan>
const _CheckoutSummaryPrice: ComponentProps<typeof CheckoutSummaryPrice> =
  null as unknown as ComponentProps<typeof CheckoutSummaryPrice>
const _CheckoutSummaryTrial: ComponentProps<typeof CheckoutSummaryTrial> =
  null as unknown as ComponentProps<typeof CheckoutSummaryTrial>
const _CheckoutSummaryTaxNote: ComponentProps<typeof CheckoutSummaryTaxNote> =
  null as unknown as ComponentProps<typeof CheckoutSummaryTaxNote>

type _PlanSelectorShape = CompoundShape<
  typeof PlanSelector,
  | 'Root'
  | 'Heading'
  | 'Grid'
  | 'Card'
  | 'CardName'
  | 'CardPrice'
  | 'CardInterval'
  | 'CardBadge'
  | 'Loading'
  | 'Error'
>
const _PlanSelectorRoot: ComponentProps<typeof PlanSelectorRoot> =
  null as unknown as ComponentProps<typeof PlanSelectorRoot>
const _PlanSelectorHeading: ComponentProps<typeof PlanSelectorHeading> =
  null as unknown as ComponentProps<typeof PlanSelectorHeading>
const _PlanSelectorGrid: ComponentProps<typeof PlanSelectorGrid> =
  null as unknown as ComponentProps<typeof PlanSelectorGrid>
const _PlanSelectorCard: ComponentProps<typeof PlanSelectorCard> =
  null as unknown as ComponentProps<typeof PlanSelectorCard>
const _PlanSelectorCardName: ComponentProps<typeof PlanSelectorCardName> =
  null as unknown as ComponentProps<typeof PlanSelectorCardName>
const _PlanSelectorCardPrice: ComponentProps<typeof PlanSelectorCardPrice> =
  null as unknown as ComponentProps<typeof PlanSelectorCardPrice>
const _PlanSelectorCardInterval: ComponentProps<typeof PlanSelectorCardInterval> =
  null as unknown as ComponentProps<typeof PlanSelectorCardInterval>
const _PlanSelectorCardBadge: ComponentProps<typeof PlanSelectorCardBadge> =
  null as unknown as ComponentProps<typeof PlanSelectorCardBadge>
const _PlanSelectorLoading: ComponentProps<typeof PlanSelectorLoading> =
  null as unknown as ComponentProps<typeof PlanSelectorLoading>
const _PlanSelectorError: ComponentProps<typeof PlanSelectorError> =
  null as unknown as ComponentProps<typeof PlanSelectorError>

type _PaymentFormShape = CompoundShape<
  typeof PaymentForm,
  | 'Root'
  | 'Summary'
  | 'CustomerFields'
  | 'PaymentElement'
  | 'CardElement'
  | 'MandateText'
  | 'TermsCheckbox'
  | 'SubmitButton'
  | 'Loading'
  | 'Error'
>
const _PaymentFormRoot: ComponentProps<typeof PaymentFormRoot> =
  null as unknown as ComponentProps<typeof PaymentFormRoot>
const _PaymentFormSummary: ComponentProps<typeof PaymentFormSummary> =
  null as unknown as ComponentProps<typeof PaymentFormSummary>
const _PaymentFormCustomerFields: ComponentProps<typeof PaymentFormCustomerFields> =
  null as unknown as ComponentProps<typeof PaymentFormCustomerFields>
const _PaymentFormPaymentElement: ComponentProps<typeof PaymentFormPaymentElement> =
  null as unknown as ComponentProps<typeof PaymentFormPaymentElement>
const _PaymentFormCardElement: ComponentProps<typeof PaymentFormCardElement> =
  null as unknown as ComponentProps<typeof PaymentFormCardElement>
const _PaymentFormMandateText: ComponentProps<typeof PaymentFormMandateText> =
  null as unknown as ComponentProps<typeof PaymentFormMandateText>
const _PaymentFormTermsCheckbox: ComponentProps<typeof PaymentFormTermsCheckbox> =
  null as unknown as ComponentProps<typeof PaymentFormTermsCheckbox>
const _PaymentFormSubmitButton: ComponentProps<typeof PaymentFormSubmitButton> =
  null as unknown as ComponentProps<typeof PaymentFormSubmitButton>
const _PaymentFormLoading: ComponentProps<typeof PaymentFormLoading> =
  null as unknown as ComponentProps<typeof PaymentFormLoading>
const _PaymentFormError: ComponentProps<typeof PaymentFormError> =
  null as unknown as ComponentProps<typeof PaymentFormError>

type _ActivationFlowShape = CompoundShape<
  typeof ActivationFlow,
  | 'Root'
  | 'Summary'
  | 'ActivateButton'
  | 'AmountPicker'
  | 'ContinueButton'
  | 'Retrying'
  | 'Activated'
  | 'Loading'
  | 'Error'
>
const _ActivationFlowRoot: ComponentProps<typeof ActivationFlowRoot> =
  null as unknown as ComponentProps<typeof ActivationFlowRoot>
const _ActivationFlowSummary: ComponentProps<typeof ActivationFlowSummary> =
  null as unknown as ComponentProps<typeof ActivationFlowSummary>
const _ActivationFlowActivateButton: ComponentProps<typeof ActivationFlowActivateButton> =
  null as unknown as ComponentProps<typeof ActivationFlowActivateButton>
const _ActivationFlowAmountPicker: ComponentProps<typeof ActivationFlowAmountPicker> =
  null as unknown as ComponentProps<typeof ActivationFlowAmountPicker>
const _ActivationFlowContinueButton: ComponentProps<typeof ActivationFlowContinueButton> =
  null as unknown as ComponentProps<typeof ActivationFlowContinueButton>
const _ActivationFlowRetrying: ComponentProps<typeof ActivationFlowRetrying> =
  null as unknown as ComponentProps<typeof ActivationFlowRetrying>
const _ActivationFlowActivated: ComponentProps<typeof ActivationFlowActivated> =
  null as unknown as ComponentProps<typeof ActivationFlowActivated>
const _ActivationFlowLoading: ComponentProps<typeof ActivationFlowLoading> =
  null as unknown as ComponentProps<typeof ActivationFlowLoading>
const _ActivationFlowError: ComponentProps<typeof ActivationFlowError> =
  null as unknown as ComponentProps<typeof ActivationFlowError>
const _ActivationFlowStep: ActivationFlowStep = 'summary'

type _AmountPickerShape = CompoundShape<
  typeof AmountPicker,
  'Root' | 'Option' | 'Custom' | 'Confirm'
>
const _AmountPickerRoot: ComponentProps<typeof AmountPickerRoot> =
  null as unknown as ComponentProps<typeof AmountPickerRoot>
const _AmountPickerOption: ComponentProps<typeof AmountPickerOption> =
  null as unknown as ComponentProps<typeof AmountPickerOption>
const _AmountPickerCustom: ComponentProps<typeof AmountPickerCustom> =
  null as unknown as ComponentProps<typeof AmountPickerCustom>
const _AmountPickerConfirm: ComponentProps<typeof AmountPickerConfirm> =
  null as unknown as ComponentProps<typeof AmountPickerConfirm>

const _BalanceBadge: ComponentProps<typeof BalanceBadge> =
  null as unknown as ComponentProps<typeof BalanceBadge>

const _CancelPlanButton: ComponentProps<typeof CancelPlanButton> =
  null as unknown as ComponentProps<typeof CancelPlanButton>

type _CancelledPlanNoticeShape = CompoundShape<
  typeof CancelledPlanNotice,
  | 'Root'
  | 'Heading'
  | 'Expires'
  | 'DaysRemaining'
  | 'AccessUntil'
  | 'CancelledOn'
  | 'Reason'
  | 'ReactivateButton'
>
const _CancelledPlanNoticeRoot: ComponentProps<typeof CancelledPlanNoticeRoot> =
  null as unknown as ComponentProps<typeof CancelledPlanNoticeRoot>
const _CancelledPlanNoticeHeading: ComponentProps<typeof CancelledPlanNoticeHeading> =
  null as unknown as ComponentProps<typeof CancelledPlanNoticeHeading>
const _CancelledPlanNoticeExpires: ComponentProps<typeof CancelledPlanNoticeExpires> =
  null as unknown as ComponentProps<typeof CancelledPlanNoticeExpires>
const _CancelledPlanNoticeDaysRemaining: ComponentProps<
  typeof CancelledPlanNoticeDaysRemaining
> = null as unknown as ComponentProps<typeof CancelledPlanNoticeDaysRemaining>
const _CancelledPlanNoticeAccessUntil: ComponentProps<typeof CancelledPlanNoticeAccessUntil> =
  null as unknown as ComponentProps<typeof CancelledPlanNoticeAccessUntil>
const _CancelledPlanNoticeCancelledOn: ComponentProps<typeof CancelledPlanNoticeCancelledOn> =
  null as unknown as ComponentProps<typeof CancelledPlanNoticeCancelledOn>
const _CancelledPlanNoticeReason: ComponentProps<typeof CancelledPlanNoticeReason> =
  null as unknown as ComponentProps<typeof CancelledPlanNoticeReason>
const _CancelledPlanNoticeReactivateButton: ComponentProps<
  typeof CancelledPlanNoticeReactivateButton
> = null as unknown as ComponentProps<typeof CancelledPlanNoticeReactivateButton>

type _CreditGateShape = CompoundShape<
  typeof CreditGate,
  'Root' | 'Heading' | 'Subheading' | 'Topup' | 'Loading' | 'Error'
>
const _CreditGateRoot: ComponentProps<typeof CreditGateRoot> =
  null as unknown as ComponentProps<typeof CreditGateRoot>
const _CreditGateHeading: ComponentProps<typeof CreditGateHeading> =
  null as unknown as ComponentProps<typeof CreditGateHeading>
const _CreditGateSubheading: ComponentProps<typeof CreditGateSubheading> =
  null as unknown as ComponentProps<typeof CreditGateSubheading>
const _CreditGateTopup: ComponentProps<typeof CreditGateTopup> =
  null as unknown as ComponentProps<typeof CreditGateTopup>
const _CreditGateLoading: ComponentProps<typeof CreditGateLoading> =
  null as unknown as ComponentProps<typeof CreditGateLoading>
const _CreditGateError: ComponentProps<typeof CreditGateError> =
  null as unknown as ComponentProps<typeof CreditGateError>

type _PurchaseGateShape = CompoundShape<
  typeof PurchaseGate,
  'Root' | 'Allowed' | 'Blocked' | 'Loading' | 'Error'
>
const _PurchaseGateRoot: ComponentProps<typeof PurchaseGateRoot> =
  null as unknown as ComponentProps<typeof PurchaseGateRoot>
const _PurchaseGateAllowed: ComponentProps<typeof PurchaseGateAllowed> =
  null as unknown as ComponentProps<typeof PurchaseGateAllowed>
const _PurchaseGateBlocked: ComponentProps<typeof PurchaseGateBlocked> =
  null as unknown as ComponentProps<typeof PurchaseGateBlocked>
const _PurchaseGateLoading: ComponentProps<typeof PurchaseGateLoading> =
  null as unknown as ComponentProps<typeof PurchaseGateLoading>
const _PurchaseGateError: ComponentProps<typeof PurchaseGateError> =
  null as unknown as ComponentProps<typeof PurchaseGateError>

type _TopupFormShape = CompoundShape<
  typeof TopupForm,
  'Root' | 'PaymentElement' | 'SubmitButton' | 'Loading' | 'Error'
>
const _TopupFormRoot: ComponentProps<typeof TopupFormRoot> =
  null as unknown as ComponentProps<typeof TopupFormRoot>
const _TopupFormPaymentElement: ComponentProps<typeof TopupFormPaymentElement> =
  null as unknown as ComponentProps<typeof TopupFormPaymentElement>
const _TopupFormSubmitButton: ComponentProps<typeof TopupFormSubmitButton> =
  null as unknown as ComponentProps<typeof TopupFormSubmitButton>
const _TopupFormLoading: ComponentProps<typeof TopupFormLoading> =
  null as unknown as ComponentProps<typeof TopupFormLoading>
const _TopupFormError: ComponentProps<typeof TopupFormError> =
  null as unknown as ComponentProps<typeof TopupFormError>

const _MandateText: ComponentProps<typeof MandateText> =
  null as unknown as ComponentProps<typeof MandateText>
const _MandateTextProps: MandateTextProps = null as unknown as MandateTextProps

const _ProductBadge: ComponentProps<typeof ProductBadge> =
  null as unknown as ComponentProps<typeof ProductBadge>
const _PlanBadge: ComponentProps<typeof PlanBadge> =
  null as unknown as ComponentProps<typeof PlanBadge>

const _Slot: ComponentProps<typeof Slot> = null as unknown as ComponentProps<typeof Slot>
const _Slottable: ComponentProps<typeof Slottable> =
  null as unknown as ComponentProps<typeof Slottable>

// Keep the compiler honest about every binding above being "used" without
// introducing runtime side effects. `void` over an object expression is
// erased but forces the references through type-checking.
// Force the compound-shape type aliases through the type-checker. Each
// `Pick` failure surfaces here when a subcomponent key goes missing.
type _CompoundShapesExist = [
  _CheckoutSummaryShape,
  _PlanSelectorShape,
  _PaymentFormShape,
  _ActivationFlowShape,
  _AmountPickerShape,
  _CancelledPlanNoticeShape,
  _CreditGateShape,
  _PurchaseGateShape,
  _TopupFormShape,
]

void [
  _CheckoutSummaryRoot,
  _CheckoutSummaryProduct,
  _CheckoutSummaryPlan,
  _CheckoutSummaryPrice,
  _CheckoutSummaryTrial,
  _CheckoutSummaryTaxNote,
  _PlanSelectorRoot,
  _PlanSelectorHeading,
  _PlanSelectorGrid,
  _PlanSelectorCard,
  _PlanSelectorCardName,
  _PlanSelectorCardPrice,
  _PlanSelectorCardInterval,
  _PlanSelectorCardBadge,
  _PlanSelectorLoading,
  _PlanSelectorError,
  _PaymentFormRoot,
  _PaymentFormSummary,
  _PaymentFormCustomerFields,
  _PaymentFormPaymentElement,
  _PaymentFormCardElement,
  _PaymentFormMandateText,
  _PaymentFormTermsCheckbox,
  _PaymentFormSubmitButton,
  _PaymentFormLoading,
  _PaymentFormError,
  _ActivationFlowRoot,
  _ActivationFlowSummary,
  _ActivationFlowActivateButton,
  _ActivationFlowAmountPicker,
  _ActivationFlowContinueButton,
  _ActivationFlowRetrying,
  _ActivationFlowActivated,
  _ActivationFlowLoading,
  _ActivationFlowError,
  _ActivationFlowStep,
  _AmountPickerRoot,
  _AmountPickerOption,
  _AmountPickerCustom,
  _AmountPickerConfirm,
  _BalanceBadge,
  _CancelPlanButton,
  _CancelledPlanNoticeRoot,
  _CancelledPlanNoticeHeading,
  _CancelledPlanNoticeExpires,
  _CancelledPlanNoticeDaysRemaining,
  _CancelledPlanNoticeAccessUntil,
  _CancelledPlanNoticeCancelledOn,
  _CancelledPlanNoticeReason,
  _CancelledPlanNoticeReactivateButton,
  _CreditGateRoot,
  _CreditGateHeading,
  _CreditGateSubheading,
  _CreditGateTopup,
  _CreditGateLoading,
  _CreditGateError,
  _PurchaseGateRoot,
  _PurchaseGateAllowed,
  _PurchaseGateBlocked,
  _PurchaseGateLoading,
  _PurchaseGateError,
  _TopupFormRoot,
  _TopupFormPaymentElement,
  _TopupFormSubmitButton,
  _TopupFormLoading,
  _TopupFormError,
  _MandateText,
  _MandateTextProps,
  _ProductBadge,
  _PlanBadge,
  _Slot,
  _Slottable,
]
