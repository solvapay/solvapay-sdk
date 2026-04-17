'use client'
import React from 'react'
import {
  PaymentElement as StripePaymentElement,
  CardElement as StripeCardElement,
} from '@stripe/react-stripe-js'
import { usePaymentForm } from './PaymentFormContext'
import { CheckoutSummary, type CheckoutSummaryProps } from './CheckoutSummary'
import { MandateText, type MandateTextProps } from './MandateText'
import { Spinner } from './Spinner'
import { useCopy, useLocale } from '../hooks/useCopy'
import { useCustomer } from '../hooks/useCustomer'
import { usePlan } from '../hooks/usePlan'
import { useProduct } from '../hooks/useProduct'
import { formatPrice } from '../utils/format'
import { deriveVariant } from '../utils/checkoutVariant'
import { resolveCta } from '../utils/checkoutCta'
import { interpolate } from '../i18n/interpolate'

// Summary slot: thin wrapper around CheckoutSummary that reads planRef/productRef from context
type SummarySlotProps = Omit<CheckoutSummaryProps, 'planRef' | 'productRef'>

export const PaymentFormSummary: React.FC<SummarySlotProps> = props => {
  const { planRef, productRef, resolvedPlanRef } = usePaymentForm()
  return (
    <CheckoutSummary
      {...props}
      planRef={planRef || resolvedPlanRef || undefined}
      productRef={productRef}
    />
  )
}

// MandateText slot
type MandateSlotProps = Omit<MandateTextProps, 'planRef' | 'productRef'>

export const PaymentFormMandateText: React.FC<MandateSlotProps> = props => {
  const { planRef, productRef, resolvedPlanRef } = usePaymentForm()
  return (
    <MandateText
      {...props}
      planRef={planRef || resolvedPlanRef || undefined}
      productRef={productRef}
    />
  )
}

// CustomerFields: read-only echo of name/email from the backend customer record.
export const PaymentFormCustomerFields: React.FC<{
  readOnly?: boolean
  className?: string
}> = ({ readOnly = true, className }) => {
  const copy = useCopy()
  const customer = useCustomer()
  const { prefillCustomer } = usePaymentForm()

  const email = customer.email ?? prefillCustomer?.email
  const name = customer.name ?? prefillCustomer?.name

  if (!email && !name) return null

  return (
    <div
      className={className}
      data-solvapay-customer-fields=""
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        fontSize: 14,
      }}
    >
      {email && (
        <div>
          <span style={{ opacity: 0.6 }}>{copy.customer.emailLabel}: </span>
          <span>{email}</span>
        </div>
      )}
      {name && (
        <div>
          <span style={{ opacity: 0.6 }}>{copy.customer.nameLabel}: </span>
          <span>{name}</span>
        </div>
      )}
      {readOnly && null}
    </div>
  )
}

// Stripe PaymentElement slot (default)
export const PaymentFormPaymentElement: React.FC<{
  options?: React.ComponentProps<typeof StripePaymentElement>['options']
}> = ({ options }) => {
  const { setElementKind, setPaymentInputComplete, isReady } = usePaymentForm()
  const locale = useLocale()

  React.useEffect(() => {
    setElementKind('payment-element')
  }, [setElementKind])

  if (!isReady) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 12 }}>
        <Spinner size="sm" />
      </div>
    )
  }

  // Stripe's PaymentElement uses its own locale option; SolvaPayProvider should
  // pass locale to <Elements options={{ locale }}>. We still toggle complete.
  return (
    <StripePaymentElement
      options={options}
      onChange={e => setPaymentInputComplete(e.complete)}
      // locale is passed through Elements options at the root; keep this prop
      // around in the ref for future callers
      key={locale || 'default'}
    />
  )
}

// Stripe CardElement slot (opt-in for narrow embeds)
export const PaymentFormCardElement: React.FC<{
  options?: React.ComponentProps<typeof StripeCardElement>['options']
}> = ({ options }) => {
  const { setElementKind, setPaymentInputComplete, isReady } = usePaymentForm()

  React.useEffect(() => {
    setElementKind('card-element')
  }, [setElementKind])

  if (!isReady) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', minHeight: 52 }}>
        <Spinner size="sm" />
      </div>
    )
  }

  return (
    <StripeCardElement
      options={options}
      onChange={e => setPaymentInputComplete(e.complete)}
    />
  )
}

// Terms checkbox slot
export const PaymentFormTermsCheckbox: React.FC<{
  className?: string
  label?: React.ReactNode
}> = ({ className, label }) => {
  const { termsAccepted, setTermsAccepted } = usePaymentForm()
  const copy = useCopy()
  const id = 'solvapay-terms-checkbox'
  return (
    <label
      className={className}
      htmlFor={id}
      style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13 }}
    >
      <input
        id={id}
        type="checkbox"
        checked={termsAccepted}
        onChange={e => setTermsAccepted(e.target.checked)}
      />
      <span>{label ?? copy.terms.checkboxLabel}</span>
    </label>
  )
}

// Submit button slot
export const PaymentFormSubmitButton: React.FC<{
  className?: string
  children?: React.ReactNode
}> = ({ className, children }) => {
  const ctx = usePaymentForm()
  const copy = useCopy()
  const locale = useLocale()
  const { plan } = usePlan({
    planRef: ctx.planRef || ctx.resolvedPlanRef || undefined,
    productRef: ctx.productRef,
  })
  const { product } = useProduct(ctx.productRef)

  const variant = deriveVariant(plan)
  const amountFormatted = formatPrice(
    plan?.price ?? 0,
    plan?.currency ?? 'usd',
    { locale, free: copy.interval.free },
  )

  const label = resolveCta({
    variant,
    plan,
    product,
    amountFormatted,
    copy,
    override: typeof children === 'string' ? children : ctx.submitButtonText,
  })

  const ariaLabel = label

  return (
    <button
      type="submit"
      disabled={!ctx.canSubmit}
      className={className ?? ctx.buttonClassName}
      aria-busy={ctx.isProcessing}
      aria-disabled={!ctx.canSubmit}
      aria-label={ariaLabel}
      onClick={e => {
        e.preventDefault()
        ctx.submit()
      }}
    >
      {ctx.isProcessing ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Spinner size="sm" />
          <span>{copy.cta.processing}</span>
        </span>
      ) : children && typeof children !== 'string' ? (
        children
      ) : (
        label
      )}
    </button>
  )
}

// Error display slot
export const PaymentFormError: React.FC<{ className?: string }> = ({ className }) => {
  const { error } = usePaymentForm()
  if (!error) return null
  return (
    <div role="alert" aria-live="assertive" aria-atomic="true" className={className}>
      {error}
    </div>
  )
}

// keep unused-import placebo to appease lint if interpolate is only needed later
void interpolate
