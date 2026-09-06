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
import { TopupForm, useTopupForm } from '../../../../primitives/TopupForm'
import { formatPrice } from '../../../../utils/format'
import { useDisplayMode } from '../../../hooks/useDisplayMode'
import { useHostLocale } from '../../../useHostLocale'
import { chargeAmountMinor } from '../../chargeAmount'
import { McpHostedBody, McpHostedLayout, McpSummaryRail } from '../../McpHosted'
import { McpPaymentHeader } from '../../McpPaymentHeader'
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
  const { displayMode } = useDisplayMode()
  const isFullscreen = displayMode === 'fullscreen'
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
    <TopupForm.Root
      amount={amountMinor}
      currency={currency}
      returnUrl={returnUrl}
      onSuccess={(_intent, extras) => onSuccess(extras)}
    >
      <McpHostedLayout>
        <McpSummaryRail>
          <div className="solvapay-mcp-checkout-order-summary" data-variant="payg">
            <div className="solvapay-mcp-checkout-order-summary-row">
              <span className={cx.muted}>
                {creditsAdded != null
                  ? `${creditsAdded.toLocaleString(locale)} credits`
                  : formatPrice(amountMinor, currency, { locale })}
              </span>
              {creditsAdded != null ? (
                <span>{formatPrice(amountMinor, currency, { locale })}</span>
              ) : null}
            </div>
            <div className="solvapay-mcp-checkout-order-summary-row">
              <span className={cx.muted}>One-time</span>
            </div>
            {isFullscreen ? (
              <TopupForm.Summary.Rows className={cx.taxSummary} />
            ) : (
              <TopupForm.Summary.TaxNote className={cx.muted} />
            )}
          </div>
        </McpSummaryRail>

        <McpHostedBody>
          <McpPaymentHeader
            backLabel="Change amount"
            onBack={onBack}
            heading="Payment"
            headingClassName={cx.heading}
          />

          <div className={cx.topupForm}>
            <TopupForm.Loading />
            <TopupForm.PaymentElement />
            <TopupForm.BusinessDetails.Root className={cx.businessDetails}>
              <TopupForm.BusinessDetails.Fields />
            </TopupForm.BusinessDetails.Root>
            <TopupForm.Error className={cx.error} />

            <TopupForm.SubmitButton className={cx.button}>
              <PaygChargeCta amountMinor={amountMinor} currency={currency} />
            </TopupForm.SubmitButton>
            <MandateText mode="topup" amountMinor={amountMinor} currency={currency} />
          </div>
        </McpHostedBody>
      </McpHostedLayout>
    </TopupForm.Root>
  )
})

function PaygChargeCta({ amountMinor, currency }: { amountMinor: number; currency: string }) {
  const locale = useHostLocale()
  const { taxBreakdown } = useTopupForm()
  const minor = chargeAmountMinor(taxBreakdown, amountMinor)
  return <>Pay {formatPrice(minor, taxBreakdown?.currency ?? currency, { locale })}</>
}
