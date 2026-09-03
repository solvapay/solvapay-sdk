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

import { countsUsage } from '@solvapay/core'
import React from 'react'
import { usePurchase } from '../hooks/usePurchase'
import { usePurchaseStatus } from '../hooks/usePurchaseStatus'
import { CancelledPlanNotice } from './CancelledPlanNotice'
import { usePaymentMethod } from '../hooks/usePaymentMethod'
import { useCopy, useLocale } from '../hooks/useCopy'
import { useBalance } from '../hooks/useBalance'
import { BalanceBadge } from './BalanceBadge'
import { CancelPlanButton } from './CancelPlanButton'
import { UpdatePaymentMethodButton } from './UpdatePaymentMethodButton'
import { UsageMeter } from '../primitives/UsageMeter'
import { formatPaygRate, type BootstrapPlanLike } from '../primitives/checkout/shared'
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
  /** "Started {date}" line. */
  startedLine?: string
  /** Monospaced purchase reference (`pur_…`). */
  reference?: string
  balanceLine?: string
  usageMeter?: string
  paymentMethod?: string
  actions?: string
  /** Small muted caption above a value when `showFieldLabels` is set. */
  fieldLabel?: string
  /** Embedded pending-cancellation notice + reactivate CTA. */
  cancelledNotice?: string
}

export interface CurrentPlanCardProps {
  /** Hide the payment-method line even when the endpoint returns a card. Default: `false`. */
  hidePaymentMethod?: boolean
  /** Hide the "Cancel plan" action. Default: `false`. */
  hideCancelButton?: boolean
  /**
   * Hide the embedded `<CancelledPlanNotice>` when renewal is already
   * cancelled. Default: `false` (notice renders when applicable). Set
   * `true` when a parent surface (e.g. MCP account view) renders its
   * own notice alongside the card.
   */
  hideCancelledNotice?: boolean
  /** Hide the "Update card" action. Default: `false`. */
  hideUpdatePaymentButton?: boolean
  /**
   * Hide the `<UsageMeter>` that automatically renders for usage-based
   * plans. Default: `false` (meter renders whenever the active plan has
   * a quota).
   */
  hideUsageMeter?: boolean
  /**
   * Hide the card's own `<h2>` heading (e.g. "Your plan"). Useful when
   * a parent surface (the MCP account view) already paints a section
   * label above the card. Default: `false`.
   */
  hideHeading?: boolean
  /**
   * Hide the product-context line (`productName` rendered above the
   * plan name when they differ). The MCP account view renders the
   * product as the surface hero, so the plan card doesn't need to
   * repeat it. Default: `false`.
   */
  hideProductContext?: boolean
  /**
   * Show the purchase start date as `Started {date}`. Default: `false`.
   * Hosted-page parity for the MCP account surface.
   */
  showStartDate?: boolean
  /**
   * Show the purchase reference (`pur_…`) in monospace. Default: `false`.
   * Hosted-page parity for the MCP account surface.
   */
  showReference?: boolean
  /**
   * Caption the price/rate and balance values with a field label
   * ("Rate", "Balance"). Default: `false`. Those lines are bare
   * numbers otherwise, which read alike on a surface that shows both.
   */
  showFieldLabels?: boolean
  /**
   * Live catalog plans. Used to format a PAYG usage rate when the
   * frozen snapshot has no `options[]`.
   */
  plans?: readonly CatalogPlanLike[]
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
  const isMetered = countsUsage(purchase.planSnapshot) || purchase.planSnapshot?.isMetered === true

  if (purchase.isRecurring) {
    const date = formatDate(purchase.nextBillingDate)
    if (!date) return null
    return (
      <span className={className} data-solvapay-current-plan-next-billing="">
        {interpolate(copy.currentPlan.nextBilling, { date })}
      </span>
    )
  }

  if (isMetered) {
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

/**
 * Structural catalog / snapshot subset `formatPaygRate` can read.
 * Wider than `BootstrapPlanLike` so MCP `PlanLike` (which allows `null`
 * on optional fields) is assignable without a cast.
 */
export interface CatalogPlanLike {
  reference?: string | null
  name?: string
  options?: BootstrapPlanLike['options'] | null
  price?: number | null
  currency?: string | null
  requiresPayment?: boolean | null
  isMetered?: boolean | null
}

function asPaygPlan(
  plan: PurchaseInfo['planSnapshot'] | CatalogPlanLike | null | undefined,
): BootstrapPlanLike | null {
  if (!plan) return null
  return {
    reference: plan.reference ?? undefined,
    name: 'name' in plan ? plan.name : undefined,
    price: plan.price ?? undefined,
    currency: plan.currency ?? undefined,
    requiresPayment: 'requiresPayment' in plan ? (plan.requiresPayment ?? undefined) : undefined,
    // Snapshot `options` are generated as `{ [key: string]: unknown }[]`;
    // formatPaygRate reads them through `@solvapay/core` as PricingOptionLike.
    options: plan.options as BootstrapPlanLike['options'],
  }
}

function resolvePriceLabel({
  isUsageBased,
  snapshot,
  catalogPlan,
  amount,
  currency,
  intervalLabel,
  locale,
  balance,
}: {
  isUsageBased: boolean
  snapshot: PurchaseInfo['planSnapshot']
  catalogPlan: CatalogPlanLike | undefined
  amount: number
  currency: string
  intervalLabel: string | undefined
  locale: string | undefined
  balance: ReturnType<typeof useBalance>
}): string | null {
  if (isUsageBased) {
    const snapshotPlan = asPaygPlan(snapshot)
    const fromSnapshot = snapshotPlan ? formatPaygRate(snapshotPlan, locale, balance) : null
    if (fromSnapshot) return fromSnapshot
    const catalogAsPlan = asPaygPlan(catalogPlan)
    if (catalogAsPlan) {
      const fromCatalog = formatPaygRate(catalogAsPlan, locale, balance)
      if (fromCatalog) return fromCatalog
    }
    return null
  }

  return formatPrice(amount, currency, {
    interval: intervalLabel,
  })
}

/**
 * Captions a value with a small muted label. Renders the value alone
 * when `label` is null, so surfaces that don't opt into field labels
 * keep the flat line-per-fact markup they already style against.
 */
function PlanField({
  label,
  labelClassName,
  children,
}: {
  label: string | null
  labelClassName?: string
  children: React.ReactNode
}) {
  if (!label) return <>{children}</>
  return (
    <div className="solvapay-current-plan-field" data-solvapay-current-plan-field="">
      <span
        className={labelClassName ?? 'solvapay-current-plan-field-label'}
        data-solvapay-current-plan-field-label=""
      >
        {label}
      </span>
      {children}
    </div>
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
  hideCancelledNotice,
  hideUpdatePaymentButton,
  hideUsageMeter,
  hideHeading,
  hideProductContext,
  showStartDate,
  showReference,
  showFieldLabels,
  plans,
  classNames: overrides,
  className,
}) => {
  const copy = useCopy()
  const locale = useLocale()
  const balance = useBalance()
  const { activePurchase } = usePurchase()
  const { formatDate, shouldShowCancelledNotice } = usePurchaseStatus()
  const { paymentMethod } = usePaymentMethod()

  if (!activePurchase) return null

  const snapshot = activePurchase.planSnapshot
  const catalogPlan = plans?.find(
    p => p.reference === (snapshot?.reference ?? activePurchase.planRef),
  )
  const isUsageBased =
    countsUsage(snapshot) || snapshot?.isMetered === true || countsUsage(catalogPlan)
  const planType = activePurchase.isRecurring
    ? 'recurring'
    : isUsageBased
      ? 'usage-based'
      : 'one-time'

  // Prefer `originalAmount` (customer-currency minor units) so the label
  // matches `currency`. `amount` is always USD cents — pairing it with a
  // non-USD `currency` would render e.g. "SEK 54.26" for a 500 SEK charge.
  const amount = activePurchase.originalAmount ?? activePurchase.amount ?? 0
  const currency = activePurchase.currency ?? 'usd'
  const rawCycle = activePurchase.billingCycle
  const cycleKey =
    rawCycle && rawCycle in copy.currentPlan.cycleUnit
      ? (rawCycle as keyof typeof copy.currentPlan.cycleUnit)
      : undefined
  const intervalLabel = cycleKey ? (copy.currentPlan.cycleUnit[cycleKey] ?? rawCycle) : rawCycle
  const priceLabel = resolvePriceLabel({
    isUsageBased,
    snapshot,
    catalogPlan,
    amount,
    currency,
    intervalLabel,
    locale,
    balance,
  })

  // Plan name is a first-class field: every plan has a name in the plans
  // table, and the backend now snapshots it at purchase time. Legacy
  // purchases (pre-snapshot) fall back to productName — never to planRef.
  const planName = activePurchase.planSnapshot?.name ?? activePurchase.productName
  const productContext =
    activePurchase.productName && activePurchase.productName !== planName
      ? activePurchase.productName
      : null

  const rootClass = ['solvapay-current-plan-card', overrides?.root, className]
    .filter(Boolean)
    .join(' ')

  // Hide the payment-method row entirely when the hook errored OR returned a
  // null (no endpoint deployed yet / MCP server doesn't expose the tool) so
  // the card degrades gracefully.
  const shouldShowPaymentMethod = !hidePaymentMethod && paymentMethod !== null

  const showCancelButton =
    !hideCancelButton && !activePurchase.cancelledAt && !shouldShowCancelledNotice

  // Surfaces that hide both actions (the MCP account view routes card
  // and cancel through the portal) would otherwise get an empty
  // section still carrying its own top margin.
  const showActions = !hideUpdatePaymentButton || showCancelButton

  return (
    <section
      className={rootClass}
      data-solvapay-current-plan-card=""
      data-plan-type={planType}
      data-solvapay-current-plan-ref={activePurchase.planRef ?? undefined}
    >
      {!hideHeading && (
        <h2
          className={overrides?.heading ?? 'solvapay-current-plan-heading'}
          data-solvapay-current-plan-heading=""
        >
          {copy.currentPlan.heading}
        </h2>
      )}

      {productContext && !hideProductContext && (
        <p
          className={overrides?.productContext ?? 'solvapay-current-plan-product-context'}
          data-solvapay-current-plan-product-context=""
        >
          {productContext}
        </p>
      )}

      <h3
        className={overrides?.planName ?? 'solvapay-current-plan-name'}
        data-solvapay-current-plan-name=""
      >
        {planName}
      </h3>

      {priceLabel ? (
        <PlanField
          label={
            showFieldLabels
              ? isUsageBased
                ? copy.currentPlan.rateFieldLabel
                : copy.currentPlan.priceFieldLabel
              : null
          }
          labelClassName={overrides?.fieldLabel}
        >
          <p
            className={overrides?.price ?? 'solvapay-current-plan-price'}
            data-solvapay-current-plan-price=""
          >
            {priceLabel}
          </p>
        </PlanField>
      ) : null}

      <PlanTypeLine
        purchase={activePurchase}
        formatDate={formatDate}
        className={overrides?.dateLine ?? 'solvapay-current-plan-date-line'}
      />

      {isUsageBased && activePurchase.isRecurring && !hideUsageMeter && (
        <section
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
        </section>
      )}

      {isUsageBased && (
        <PlanField
          label={showFieldLabels ? copy.currentPlan.balanceFieldLabel : null}
          labelClassName={overrides?.fieldLabel}
        >
          <p
            className={overrides?.balanceLine ?? 'solvapay-current-plan-balance-line'}
            data-solvapay-current-plan-balance-line=""
          >
            <BalanceBadge />
          </p>
        </PlanField>
      )}

      {/* Provenance trails the money facts: what the plan costs and
       *  what's left read as one group, then when it started. Slotting
       *  the start date between price and balance splits that pair. */}
      {showStartDate &&
        (() => {
          const started = formatDate(activePurchase.startDate)
          if (!started) return null
          return (
            <span
              className={overrides?.startedLine ?? 'solvapay-current-plan-started-line'}
              data-solvapay-current-plan-started-line=""
            >
              {interpolate(copy.currentPlan.startedOn, { date: started })}
            </span>
          )
        })()}

      {showReference && activePurchase.reference && (
        <span
          className={overrides?.reference ?? 'solvapay-current-plan-reference'}
          data-solvapay-current-plan-reference=""
        >
          {activePurchase.reference}
        </span>
      )}

      {shouldShowPaymentMethod && paymentMethod && (
        <PaymentMethodLine
          paymentMethod={paymentMethod}
          className={overrides?.paymentMethod ?? 'solvapay-current-plan-payment-method'}
        />
      )}

      {showActions && (
        <section
          className={overrides?.actions ?? 'solvapay-current-plan-actions'}
          data-solvapay-current-plan-actions=""
        >
          {!hideUpdatePaymentButton && <UpdatePaymentMethodButton />}
          {showCancelButton && <CancelPlanButton />}
        </section>
      )}

      {shouldShowCancelledNotice && !hideCancelledNotice && (
        <CancelledPlanNotice
          className={overrides?.cancelledNotice ?? 'solvapay-current-plan-cancelled-notice'}
        />
      )}
    </section>
  )
}
