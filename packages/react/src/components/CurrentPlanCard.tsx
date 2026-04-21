'use client'

/**
 * `<CurrentPlanCard>` — summary card for the customer's active purchase.
 *
 * Pure projection of existing provider state (`usePurchase`,
 * `usePurchaseStatus`, `useBalance`, `usePaymentMethod`) plus Phase 1
 * action components (`<CancelPlanButton>`, Phase 2's
 * `<UpdatePaymentMethodButton>`). No Stripe Elements dependency, so the
 * default tree renders identically inside an MCP host sandbox and a
 * standalone HTTP app.
 *
 * Returns `null` when `usePurchase()` reports no active purchase, so
 * integrators can drop it into account pages without wrapping in
 * `{hasPaidPurchase && ...}`.
 *
 * Plan-type-aware lines:
 * - `recurring` — "Next billing: {date}"
 * - `one-time`  — "Expires {date}" or "Valid indefinitely"
 * - `usage-based` — `<BalanceBadge>` line; no date
 */

import React from 'react'
import { usePurchase } from '../hooks/usePurchase'
import { usePurchaseStatus } from '../hooks/usePurchaseStatus'
import { usePaymentMethod } from '../hooks/usePaymentMethod'
import { useCopy } from '../hooks/useCopy'
import { BalanceBadge } from './BalanceBadge'
import { CancelPlanButton } from './CancelPlanButton'
import { UpdatePaymentMethodButton } from './UpdatePaymentMethodButton'
import { UsageMeter } from '../primitives/UsageMeter'
import { formatPrice } from '../utils/format'
import { interpolate } from '../i18n/interpolate'
import type { PaymentMethodInfo } from '@solvapay/server'
import type { PurchaseInfo } from '../types'

export interface CurrentPlanCardClassNames {
  root?: string
  heading?: string
  planName?: string
  productContext?: string
  price?: string
  dateLine?: string
  balanceLine?: string
  usageMeter?: string
  paymentMethod?: string
  actions?: string
}

export interface CurrentPlanCardProps {
  /** Hide the payment-method line even when the endpoint returns a card. Default: `false`. */
  hidePaymentMethod?: boolean
  /** Hide the "Cancel plan" action. Default: `false`. */
  hideCancelButton?: boolean
  /** Hide the "Update card" action. Default: `false`. */
  hideUpdatePaymentButton?: boolean
  /**
   * Hide the `<UsageMeter>` that automatically renders for usage-based
   * plans. Default: `false` (meter renders whenever the active plan has
   * a quota).
   */
  hideUsageMeter?: boolean
  /** Per-element classNames. */
  classNames?: CurrentPlanCardClassNames
  /**
   * Custom className on the root. Appended after `solvapay-current-plan-card`
   * so integrators can tweak without losing the SDK baseline.
   */
  className?: string
}

function PlanTypeLine({
  purchase,
  formatDate,
  className,
}: {
  purchase: PurchaseInfo
  formatDate: (d?: string) => string | null
  className?: string
}) {
  const copy = useCopy()
  const planType = purchase.planSnapshot?.planType ?? 'one-time'

  if (planType === 'recurring' || purchase.isRecurring) {
    const date = formatDate(purchase.nextBillingDate)
    if (!date) return null
    return (
      <span
        className={className}
        data-solvapay-current-plan-next-billing=""
      >
        {interpolate(copy.currentPlan.nextBilling, { date })}
      </span>
    )
  }

  if (planType === 'usage-based') {
    // Usage-based plans show a balance badge instead of a date.
    return null
  }

  // one-time
  const date = formatDate(purchase.endDate)
  return (
    <span className={className} data-solvapay-current-plan-expires="">
      {date
        ? interpolate(copy.currentPlan.expiresOn, { date })
        : copy.currentPlan.validIndefinitely}
    </span>
  )
}

function PaymentMethodLine({
  paymentMethod,
  className,
}: {
  paymentMethod: PaymentMethodInfo
  className?: string
}) {
  const copy = useCopy()

  if (paymentMethod.kind === 'none') {
    return (
      <span className={className} data-solvapay-current-plan-payment-method="none">
        {copy.currentPlan.noPaymentMethod}
      </span>
    )
  }

  const brandDisplay = paymentMethod.brand.charAt(0).toUpperCase() + paymentMethod.brand.slice(1)
  const label = interpolate(copy.currentPlan.paymentMethod, {
    brand: brandDisplay,
    last4: paymentMethod.last4,
  })
  const expires = interpolate(copy.currentPlan.paymentMethodExpires, {
    month: String(paymentMethod.expMonth).padStart(2, '0'),
    year: paymentMethod.expYear,
  })
  return (
    <span className={className} data-solvapay-current-plan-payment-method="card">
      {label}, {expires}
    </span>
  )
}

export const CurrentPlanCard: React.FC<CurrentPlanCardProps> = ({
  hidePaymentMethod,
  hideCancelButton,
  hideUpdatePaymentButton,
  hideUsageMeter,
  classNames: overrides,
  className,
}) => {
  const copy = useCopy()
  const { activePurchase } = usePurchase()
  const { formatDate } = usePurchaseStatus()
  const { paymentMethod } = usePaymentMethod()

  if (!activePurchase) return null

  const planType = activePurchase.planSnapshot?.planType ?? 'one-time'
  const isUsageBased = planType === 'usage-based'

  // Prefer `originalAmount` (customer-currency minor units) so the label
  // matches `currency`. `amount` is always USD cents — pairing it with a
  // non-USD `currency` would render e.g. "SEK 54.26" for a 500 SEK charge.
  const amount = activePurchase.originalAmount ?? activePurchase.amount ?? 0
  const currency = activePurchase.currency ?? 'usd'
  const cycleKey = activePurchase.billingCycle as
    | keyof typeof copy.currentPlan.cycleUnit
    | undefined
  const intervalLabel = cycleKey ? copy.currentPlan.cycleUnit[cycleKey] ?? cycleKey : undefined
  const priceLabel = formatPrice(amount, currency, {
    interval: intervalLabel,
  })

  // Plan name is a first-class field: every plan has a name in the plans
  // table, and the backend now snapshots it at purchase time. Legacy
  // purchases (pre-snapshot) fall back to productName — never to planRef.
  const planName = activePurchase.planSnapshot?.name ?? activePurchase.productName
  const productContext =
    activePurchase.productName && activePurchase.productName !== planName
      ? activePurchase.productName
      : null

  const rootClass = [
    'solvapay-current-plan-card',
    overrides?.root,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  // Hide the payment-method row entirely when the hook errored OR returned a
  // null (no endpoint deployed yet / MCP server doesn't expose the tool) so
  // the card degrades gracefully.
  const shouldShowPaymentMethod =
    !hidePaymentMethod && paymentMethod !== null

  return (
    <div
      className={rootClass}
      data-solvapay-current-plan-card=""
      data-plan-type={planType}
      data-solvapay-current-plan-ref={activePurchase.planRef ?? undefined}
    >
      <h2
        className={overrides?.heading ?? 'solvapay-current-plan-heading'}
        data-solvapay-current-plan-heading=""
      >
        {copy.currentPlan.heading}
      </h2>

      {productContext && (
        <div
          className={overrides?.productContext ?? 'solvapay-current-plan-product-context'}
          data-solvapay-current-plan-product-context=""
        >
          {productContext}
        </div>
      )}

      <div
        className={overrides?.planName ?? 'solvapay-current-plan-name'}
        data-solvapay-current-plan-name=""
      >
        {planName}
      </div>

      <div
        className={overrides?.price ?? 'solvapay-current-plan-price'}
        data-solvapay-current-plan-price=""
      >
        {priceLabel}
      </div>

      <PlanTypeLine
        purchase={activePurchase}
        formatDate={formatDate}
        className={overrides?.dateLine ?? 'solvapay-current-plan-date-line'}
      />

      {isUsageBased && !hideUsageMeter && (
        <div
          className={overrides?.usageMeter ?? 'solvapay-current-plan-usage-meter'}
          data-solvapay-current-plan-usage-meter=""
        >
          <UsageMeter.Root>
            <UsageMeter.Label />
            <UsageMeter.Bar />
            <UsageMeter.Percentage />
            <UsageMeter.ResetsIn />
            <UsageMeter.Loading />
          </UsageMeter.Root>
        </div>
      )}

      {isUsageBased && (
        <div
          className={overrides?.balanceLine ?? 'solvapay-current-plan-balance-line'}
          data-solvapay-current-plan-balance-line=""
        >
          <BalanceBadge />
        </div>
      )}

      {shouldShowPaymentMethod && paymentMethod && (
        <PaymentMethodLine
          paymentMethod={paymentMethod}
          className={overrides?.paymentMethod ?? 'solvapay-current-plan-payment-method'}
        />
      )}

      <div
        className={overrides?.actions ?? 'solvapay-current-plan-actions'}
        data-solvapay-current-plan-actions=""
      >
        {!hideUpdatePaymentButton && <UpdatePaymentMethodButton />}
        {!hideCancelButton && <CancelPlanButton />}
      </div>
    </div>
  )
}
