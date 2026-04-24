'use client'

/**
 * Step 3a — PAYG payment (after `activate_plan` fired in the amount
 * step). Uses `TopupForm` for a one-shot credit purchase; credits land
 * via the Stripe webhook so `onSuccess` fires immediately after
 * confirmation.
 */

import React, { memo } from 'react'
import { TopupForm } from '../../../../primitives/TopupForm'
import { formatPrice } from '../../../../utils/format'
import { useHostLocale } from '../../../useHostLocale'
import { BackLink } from '../../BackLink'
import type { BootstrapPlanLike, Cx } from '../shared'

interface PaygPaymentStepProps {
  plan: BootstrapPlanLike
  amountMinor: number
  returnUrl: string
  onBack: () => void
  onSuccess: () => void
  cx: Cx
}

export const PaygPaymentStep = memo(function PaygPaymentStep({
  plan,
  amountMinor,
  returnUrl,
  onBack,
  onSuccess,
  cx,
}: PaygPaymentStepProps) {
  const currency = (plan.currency ?? 'USD').toUpperCase()
  const locale = useHostLocale()
  const creditsPerUnit = plan.creditsPerUnit ?? 1
  const creditsAdded = Math.round(amountMinor * creditsPerUnit)

  return (
    <>
      <BackLink label="Change amount" onClick={onBack} />

      <h2 className={cx.heading}>Payment</h2>

      <div className="solvapay-mcp-checkout-order-summary" data-variant="payg">
        <div className="solvapay-mcp-checkout-order-summary-row">
          <span className={cx.muted}>{creditsAdded.toLocaleString(locale)} credits</span>
          <span>{formatPrice(amountMinor, currency, { locale })}</span>
        </div>
        <div className="solvapay-mcp-checkout-order-summary-row">
          <span className={cx.muted}>One-time</span>
        </div>
      </div>

      <TopupForm.Root
        amount={amountMinor}
        currency={currency}
        returnUrl={returnUrl}
        className={cx.topupForm}
        onSuccess={() => onSuccess()}
      >
        <TopupForm.Loading />
        <TopupForm.PaymentElement />
        <TopupForm.Error className={cx.error} />

        {/* Per brief §4: optional "Save card for future top-ups"
            checkbox below the Stripe element. Purely informational
            today — Stripe's default `setup_future_usage` from the
            intent dictates whether the card actually gets saved. */}
        <label className="solvapay-mcp-checkout-save-card">
          <input type="checkbox" defaultChecked />
          <span className={cx.muted}>Save card for future top-ups</span>
        </label>

        <TopupForm.SubmitButton className={cx.button}>
          Pay {formatPrice(amountMinor, currency, { locale })}
        </TopupForm.SubmitButton>
      </TopupForm.Root>
    </>
  )
})
