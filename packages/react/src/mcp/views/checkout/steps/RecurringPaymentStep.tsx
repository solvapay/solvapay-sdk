'use client'

/**
 * Step 3b — Recurring payment. Uses `PaymentForm` to drive Stripe's
 * subscribe-style confirmation; the backend creates a payment intent
 * against the selected plan+product combo.
 */

import React, { memo } from 'react'
import type { PaymentIntent } from '@stripe/stripe-js'
import { usePaymentForm } from '../../../../components/PaymentFormContext'
import { PaymentForm } from '../../../../primitives/PaymentForm'
import { usePlanSelection } from '../../../../components/PlanSelectionContext'
import { formatPrice } from '../../../../utils/format'
import { resolvePlanPricingOption } from '../../../../utils/planPricing'
import type { Plan } from '../../../../types'
import { useDisplayMode } from '../../../hooks/useDisplayMode'
import { useHostLocale } from '../../../useHostLocale'
import { chargeAmountMinor } from '../../chargeAmount'
import { McpHostedBody, McpHostedLayout, McpSummaryRail } from '../../McpHosted'
import { McpPaymentHeader } from '../../McpPaymentHeader'
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
  const { displayMode } = useDisplayMode()
  const isFullscreen = displayMode === 'fullscreen'

  return (
    <PaymentForm.Root
      planRef={planRef}
      productRef={productRef}
      returnUrl={returnUrl}
      requireTermsAcceptance={false}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onSuccess={onSuccess as any}
    >
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
            {isFullscreen ? (
              <PaymentForm.TaxSummary.Rows className={cx.taxSummary} />
            ) : (
              <PaymentForm.TaxSummary.TaxNote className={cx.muted} />
            )}
          </div>
        </McpSummaryRail>

        <McpHostedBody>
          <McpPaymentHeader
            backLabel="Change plan"
            onBack={onBack}
            heading="Payment"
            headingClassName={cx.heading}
          />

          <PaymentForm.Loading />
          <PaymentForm.PaymentElement />
          <PaymentForm.BusinessDetails.Root className={cx.businessDetails}>
            <PaymentForm.BusinessDetails.Fields />
          </PaymentForm.BusinessDetails.Root>
          <PaymentForm.Error className={cx.error} />
          <PaymentForm.MandateText />

          <PaymentForm.SubmitButton className={cx.button}>
            <RecurringChargeCta amountMinor={amountMinor} currency={currency} cycle={cycle} />
          </PaymentForm.SubmitButton>
        </McpHostedBody>
      </McpHostedLayout>
    </PaymentForm.Root>
  )
})

function RecurringChargeCta({
  amountMinor,
  currency,
  cycle,
}: {
  amountMinor: number
  currency: string
  cycle: string
}) {
  const locale = useHostLocale()
  const { taxBreakdown } = usePaymentForm()
  const minor = chargeAmountMinor(taxBreakdown, amountMinor)
  return (
    <>
      Subscribe — {formatPrice(minor, taxBreakdown?.currency ?? currency, { locale })}/
      {shortCycle(cycle)}
    </>
  )
}
