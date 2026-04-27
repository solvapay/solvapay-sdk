'use client'

/**
 * Default-tree shim over the `PaymentForm` primitive.
 *
 * Consumers who just want a drop-in payment form use this component. It
 * renders the primitive's Root with a golden-path default tree composed of
 * `PaymentForm.Summary`, `CustomerFields`, `PaymentElement`, `MandateText`,
 * an optional `TermsCheckbox`, and `SubmitButton`. Free-plan activation
 * flows through the same composition — `FreeInner` in the primitive swaps
 * the submit handler so the default tree works identically for paid and
 * free plans.
 *
 * The `<MandateText>` sentence carries the legal commitment (terms +
 * privacy URLs are linkified inline), so the default tree intentionally
 * does NOT append `<LegalFooter />` — that strip is reserved for shells
 * that compose multiple cards. Consumers who want it can opt back in
 * via the `LegalFooter` namespace member or by composing their own tree.
 *
 * Full control (swap PaymentElement for CardElement, reorder, compose with
 * shadcn/Tailwind) is available via the primitives at
 * `@solvapay/react/primitives`.
 */

import React from 'react'
import {
  PaymentForm as Primitive,
  PaymentFormSummary,
  PaymentFormCustomerFields,
  PaymentFormPaymentElement,
  PaymentFormCardElement,
  PaymentFormMandateText,
  PaymentFormTermsCheckbox,
  PaymentFormSubmitButton,
  PaymentFormLoading,
  PaymentFormError,
  PaymentFormLegalFooter,
} from './primitives/PaymentForm'
import type { PaymentFormProps, PrefillCustomer } from './types'

type PaymentFormRootProps = PaymentFormProps & {
  prefillCustomer?: PrefillCustomer
  requireTermsAcceptance?: boolean
  children?: React.ReactNode
}

const DefaultTree: React.FC<{ requireTermsAcceptance: boolean }> = ({
  requireTermsAcceptance,
}) => (
  <>
    <Primitive.Summary />
    <Primitive.CustomerFields />
    <Primitive.PaymentElement />
    <Primitive.Error />
    <Primitive.MandateText />
    {requireTermsAcceptance && <Primitive.TermsCheckbox />}
    <Primitive.SubmitButton />
  </>
)

const PaymentFormBase: React.FC<PaymentFormRootProps> = props => {
  const { children, requireTermsAcceptance = false } = props
  return (
    <Primitive.Root {...props}>
      {children ?? <DefaultTree requireTermsAcceptance={requireTermsAcceptance} />}
    </Primitive.Root>
  )
}

export const PaymentForm: React.FC<PaymentFormRootProps> & {
  Summary: typeof PaymentFormSummary
  CustomerFields: typeof PaymentFormCustomerFields
  PaymentElement: typeof PaymentFormPaymentElement
  CardElement: typeof PaymentFormCardElement
  MandateText: typeof PaymentFormMandateText
  TermsCheckbox: typeof PaymentFormTermsCheckbox
  SubmitButton: typeof PaymentFormSubmitButton
  Loading: typeof PaymentFormLoading
  Error: typeof PaymentFormError
  LegalFooter: typeof PaymentFormLegalFooter
} = Object.assign(PaymentFormBase, {
  Summary: PaymentFormSummary,
  CustomerFields: PaymentFormCustomerFields,
  PaymentElement: PaymentFormPaymentElement,
  CardElement: PaymentFormCardElement,
  MandateText: PaymentFormMandateText,
  TermsCheckbox: PaymentFormTermsCheckbox,
  SubmitButton: PaymentFormSubmitButton,
  Loading: PaymentFormLoading,
  Error: PaymentFormError,
  LegalFooter: PaymentFormLegalFooter,
})
