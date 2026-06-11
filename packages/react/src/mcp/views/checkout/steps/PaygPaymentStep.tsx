'use client'

/**
 * Step 3a — PAYG payment (after `activate_plan` fired in the amount
 * step). Uses `TopupForm` for a one-shot credit purchase; credits land
 * via the Stripe webhook so `onSuccess` fires immediately after
 * confirmation.
 */

import React, { memo } from 'react'
import { useBalance } from '../../../../hooks/useBalance'
import { MandateText } from '../../../../primitives/MandateText'
import { TopupForm } from '../../../../primitives/TopupForm'
import { formatPrice } from '../../../../utils/format'
import { useHostLocale } from '../../../useHostLocale'
import { BackLink } from '../../BackLink'
import type { TopupFormSuccessExtras } from '../../../../types'
import type { BootstrapPlanLike, Cx } from '../shared'

interface PaygPaymentStepProps {
  plan: BootstrapPlanLike
  amountMinor: number
  topupCurrency?: string | null
  returnUrl: string
  onBack: () => void
  onSuccess: (extras?: TopupFormSuccessExtras) => void
  cx: Cx
}

export const PaygPaymentStep = memo(function PaygPaymentStep({
  plan: _plan,
  amountMinor,
  topupCurrency,
  returnUrl,
  onBack,
  onSuccess,
  cx,
}: PaygPaymentStepProps) {
  // Topup currency comes from the merchant/picker only — never the plan, so a
  // plan's own currency can't leak into a merchant-wide credit topup.
  const currency = (topupCurrency ?? 'USD').toUpperCase()
  const locale = useHostLocale()
  const { creditsPerMinorUnit, displayExchangeRate } = useBalance()
  // `creditsPerMinorUnit` is the mint rate the backend surfaces on the
  // balance DTO (credits granted per paid minor unit). Unlike
  // `plan.creditsPerUnit` — which is the *debit* rate (credits
  // consumed per usage unit) — it is the right input for a
  // "credits you'll receive" preview. When the balance hasn't
  // loaded or the provider didn't return the field, hide the row
  // rather than show a meaningless number.
  const creditsAdded =
    creditsPerMinorUnit != null && creditsPerMinorUnit > 0
      ? Math.floor((amountMinor / (displayExchangeRate ?? 1)) * creditsPerMinorUnit)
      : null

  return (
    <>
      <BackLink label="Change amount" onClick={onBack} />

      <h2 className={cx.heading}>Payment</h2>

      <div className="solvapay-mcp-checkout-order-summary" data-variant="payg">
        <div className="solvapay-mcp-checkout-order-summary-row">
          <span className={cx.muted}>
            {creditsAdded != null
              ? `${creditsAdded.toLocaleString(locale)} credits`
              : formatPrice(amountMinor, currency, { locale })}
          </span>
          {creditsAdded != null ? <span>{formatPrice(amountMinor, currency, { locale })}</span> : null}
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
        onSuccess={(_intent, extras) => onSuccess(extras)}
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

        <MandateText mode="topup" amountMinor={amountMinor} currency={currency} />
        <TopupForm.SubmitButton className={cx.button}>
          Pay {formatPrice(amountMinor, currency, { locale })}
        </TopupForm.SubmitButton>
      </TopupForm.Root>
    </>
  )
})
