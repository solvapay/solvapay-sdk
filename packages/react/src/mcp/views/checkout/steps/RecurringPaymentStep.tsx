'use client'

/**
 * Step 3b — Recurring payment. Uses `PaymentForm` to drive Stripe's
 * subscribe-style confirmation; the backend creates a payment intent
 * against the selected plan+product combo.
 */

import React, { memo } from 'react'
import type { PaymentIntent } from '@stripe/stripe-js'
import { PaymentForm } from '../../../../primitives/PaymentForm'
import { formatPrice } from '../../../../utils/format'
import { useHostLocale } from '../../../useHostLocale'
import { BackLink } from '../../BackLink'
import type { BootstrapPlanLike, Cx } from '../shared'
import { inferIncludedCredits, shortCycle } from '../shared'

interface RecurringPaymentStepProps {
  plan: BootstrapPlanLike
  planRef: string
  productRef: string
  returnUrl: string
  onBack: () => void
  onSuccess: (intent: PaymentIntent) => void
  cx: Cx
}

export const RecurringPaymentStep = memo(function RecurringPaymentStep({
  plan,
  planRef,
  productRef,
  returnUrl,
  onBack,
  onSuccess,
  cx,
}: RecurringPaymentStepProps) {
  const currency = (plan.currency ?? 'USD').toUpperCase()
  const locale = useHostLocale()
  const amountMinor = plan.price ?? 0
  const cycle = plan.billingCycle ?? 'monthly'
  const credits = inferIncludedCredits(plan)
  const planName = plan.name ?? 'Plan'

  return (
    <>
      <BackLink label="Change plan" onClick={onBack} />

      <h2 className={cx.heading}>Payment</h2>

      <div className="solvapay-mcp-checkout-order-summary" data-variant="recurring">
        <div className="solvapay-mcp-checkout-order-summary-row">
          <span className={cx.muted}>{planName}</span>
          <span>
            {formatPrice(amountMinor, currency, { locale })}/{shortCycle(cycle)}
          </span>
        </div>
        {credits > 0 ? (
          <div className="solvapay-mcp-checkout-order-summary-row">
            <span className={cx.muted}>{credits.toLocaleString(locale)} credits included</span>
          </div>
        ) : null}
      </div>

      <PaymentForm.Root
        planRef={planRef}
        productRef={productRef}
        returnUrl={returnUrl}
        requireTermsAcceptance={false}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onSuccess={onSuccess as any}
      >
        <PaymentForm.Loading />
        <PaymentForm.PaymentElement />
        <PaymentForm.Error className={cx.error} />

        <p className={`${cx.muted} solvapay-mcp-checkout-terms`.trim()}>
          By subscribing, you agree {planName} renews {cycle} at{' '}
          {formatPrice(amountMinor, currency, { locale })} until you cancel.
        </p>

        <PaymentForm.SubmitButton className={cx.button}>
          Subscribe — {formatPrice(amountMinor, currency, { locale })}/{shortCycle(cycle)}
        </PaymentForm.SubmitButton>
      </PaymentForm.Root>
    </>
  )
})
