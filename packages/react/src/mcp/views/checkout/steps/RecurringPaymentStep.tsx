'use client'

/**
 * Step 3b — Recurring payment. Uses `PaymentForm` to drive Stripe's
 * subscribe-style confirmation; the backend creates a payment intent
 * against the selected plan+product combo.
 */

import React, { memo } from 'react'
import type { PaymentIntent } from '@stripe/stripe-js'
import { PaymentForm } from '../../../../primitives/PaymentForm'
import { usePlanSelection } from '../../../../components/PlanSelectionContext'
import { formatPrice } from '../../../../utils/format'
import { resolvePlanPricingOption } from '../../../../utils/planPricing'
import type { Plan } from '../../../../types'
import { useHostLocale } from '../../../useHostLocale'
import { BackLink } from '../../BackLink'
import { McpHostedBody, McpHostedLayout, McpSummaryRail } from '../../McpHosted'
import type { BootstrapPlanLike, Cx } from '../shared'
import { inferIncludedUnits, planBillingInterval, planMeterName, shortCycle } from '../shared'

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
  const planSelection = usePlanSelection()
  const pricingOption = resolvePlanPricingOption(
    plan as unknown as Plan,
    planSelection?.selectedCurrency,
  )
  const currency = pricingOption.currency.toUpperCase()
  const locale = useHostLocale()
  const amountMinor = pricingOption.price ?? 0
  const cycle = planBillingInterval(plan) ?? 'month'
  const included = inferIncludedUnits(plan)
  const meterName = planMeterName(plan) ?? 'units'
  const planName = plan.name ?? 'Plan'

  return (
    <McpHostedLayout>
      <McpSummaryRail>
        <div className="solvapay-mcp-checkout-order-summary" data-variant="recurring">
          <div className="solvapay-mcp-checkout-order-summary-row">
            <span className={cx.muted}>{planName}</span>
            <span>
              {formatPrice(amountMinor, currency, { locale })}/{shortCycle(cycle)}
            </span>
          </div>
          {included != null ? (
            <div className="solvapay-mcp-checkout-order-summary-row">
              <span className={cx.muted}>
                {included.toLocaleString(locale)} {meterName} included
              </span>
            </div>
          ) : null}
        </div>
      </McpSummaryRail>

      <McpHostedBody>
        <BackLink label="Change plan" onClick={onBack} />

        <h2 className={cx.heading}>Payment</h2>

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
          <PaymentForm.BusinessDetails.Root className={cx.businessDetails}>
            <label className={cx.businessToggle}>
              <PaymentForm.BusinessDetails.Toggle />
              I&apos;m purchasing as a business
            </label>
            <PaymentForm.BusinessDetails.BusinessName
              className={cx.businessField}
              placeholder="Business name"
            />
            <PaymentForm.BusinessDetails.Country className={cx.businessField} />
            <PaymentForm.BusinessDetails.TaxId
              className={cx.businessField}
              placeholder="Tax / VAT ID"
            />
          </PaymentForm.BusinessDetails.Root>
          {/* `Rows` (not the bare leaves) so every line is labelled — the leaves
            render amounts only, which is why business checkout showed a naked
            "$90 / VAT Free / $90" column. DEV-723. */}
          <PaymentForm.TaxSummary.Rows className={cx.taxSummary} />
          <PaymentForm.Error className={cx.error} />
          <PaymentForm.MandateText />

          <PaymentForm.SubmitButton className={cx.button}>
            Subscribe — {formatPrice(amountMinor, currency, { locale })}/{shortCycle(cycle)}
          </PaymentForm.SubmitButton>
        </PaymentForm.Root>
      </McpHostedBody>
    </McpHostedLayout>
  )
})
