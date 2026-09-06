/**
 * Shared types and pure helpers for the checkout primitive.
 *
 * Consumed by `useCheckoutFlow` and the `CheckoutSteps.*` parts. No
 * side-effects, no React imports — keeps the helpers reusable from
 * the MCP wrapper and any custom integrator surface that wants to
 * build its own layout on top of `useCheckoutFlow`.
 */

import {
  billingCycle as readBillingCycle,
  creditsPerUnitFromBalance,
  includedUnits,
  meterName,
  planPricingShape,
  usageRate,
  type BalancePegLike,
  type BillingCycleLike,
  type PricingOptionLike,
} from '@solvapay/core'
import type { Plan } from '../../types'
import { formatPrice } from '../../utils/format'
import { isPaygPlan } from '../../utils/isPayg'
import { getPlanPricingOptions, type PlanPricingOption } from '../../utils/planPricing'

export type CheckoutStep = 'plan' | 'amount' | 'payment' | 'success'

export const CHECKOUT_STEPS = ['plan', 'amount', 'payment', 'success'] as const

/**
 * Structural subset of a bootstrap plan. Kept here so step components
 * can type against it without pulling in the full `@solvapay/mcp`
 * bootstrap types (which would create a dep cycle).
 *
 * Mirrors what the API actually sends: pricing lives in `options[]`, and
 * the only derived scalars on the wire are `type`, `price`, `currency`
 * and `requiresPayment`. Every field admits `null` because frozen plan
 * snapshots send it explicitly; it is read as "absent" throughout.
 */
export interface BootstrapPlanLike {
  reference?: string | null
  name?: string | null
  type?: string | null
  price?: number | null
  currency?: string | null
  requiresPayment?: boolean | null
  options?: PricingOptionLike[] | null
  pricingOptions?: Array<{
    currency: string
    price: number
    basePrice?: number
    setupFee?: number
    default?: boolean
  }>
}

export type SuccessMeta =
  | {
      branch: 'payg'
      /** Omitted when the plan activated against an already-funded wallet. */
      amountMinor?: number
      currency?: string
      creditsAdded?: number
      plan: BootstrapPlanLike
      /** `null` when neither a credit nor a charge rate can be established. */
      rateLabel: string | null
    }
  | {
      branch: 'recurring'
      plan: BootstrapPlanLike
      /** Per-cycle allowance in metered items. `null` when unlimited or unmetered. */
      includedUnits: number | null
      /** The meter `includedUnits` counts, e.g. `'requests'`. */
      meterName: string | null
      chargedTodayMinor: number
      currency: string
      nextRenewalLabel: string | null
    }

export function isPayg(plan: BootstrapPlanLike | null | undefined): boolean {
  return isPaygPlan(plan ?? null)
}

/** Plan rows from the SDK satisfy the bootstrap subset used by checkout steps. */
export function toBootstrapPlanLike(plan: Plan | null): BootstrapPlanLike | null {
  return plan
}

/** Sort PAYG first, then recurring ascending by price. */
export function planSortByPaygFirstThenAsc(a: Plan, b: Plan): number {
  const aPayg = isPayg(toBootstrapPlanLike(a))
  const bPayg = isPayg(toBootstrapPlanLike(b))
  if (aPayg && !bPayg) return -1
  if (!aPayg && bPayg) return 1
  return (a.price ?? 0) - (b.price ?? 0)
}

function resolveBootstrapPlanPricing(plan: BootstrapPlanLike): PlanPricingOption {
  const options = getPlanPricingOptions(plan)
  return options.find(option => option.default) ?? options[0]
}

/**
 * Default plan filter for the SDK's checkout / paywall surfaces.
 *
 * Aligns with the hosted-checkout topup pattern (`solvapay-frontend`'s
 * `/checkout/topup` route): a topup product needs only one usage-based
 * plan with `creditsPerUnit` — `<AmountPicker>` handles credit-pack
 * selection via currency presets, so separate "100 Credits" / "250
 * Credits" pack plans are an antipattern.
 *
 *   - Always hides Free plans (`requiresPayment === false`).
 *   - Hides PAYG when the same product also exposes at least one
 *     non-PAYG paid plan (legacy "PAYG + credit pack" config). PAYG
 *     is the meter; surfacing it alongside one-time / recurring plans
 *     frames it as a sibling tier, which it isn't.
 *   - Keeps PAYG when it's the only paid option, so PAYG-only topup
 *     products surface a single PAYG card on the plan step that the
 *     user clicks before continuing into the `AmountPicker` — the
 *     canonical hosted-checkout shape.
 *
 * Built from the full plan list rather than as a per-plan predicate
 * because the PAYG decision depends on what else the product exposes.
 */
export function buildDefaultCheckoutPlanFilter(
  allPlans: readonly Plan[],
): (plan: Plan, index: number) => boolean {
  const hasNonPaygPaid = allPlans.some(
    p => p.requiresPayment !== false && !isPayg(toBootstrapPlanLike(p)),
  )
  return plan => {
    if (plan.requiresPayment === false) return false
    if (hasNonPaygPaid && isPayg(toBootstrapPlanLike(plan))) return false
    return true
  }
}

export function formatContinueLabel(
  plan: BootstrapPlanLike | null,
  locale?: string,
  pricingOption?: PlanPricingOption,
): string {
  if (!plan) return 'Continue'
  const priceLabel = formatPlanPriceLabel(plan, locale ?? 'en-US', pricingOption)
  return `Continue with ${plan.name ?? 'Plan'} — ${priceLabel}`
}

/**
 * The plan's billing cycle, or `null` for one-time and pure usage-based
 * plans. Sourced from the `billingCycle` option.
 */
export function planBillingCycle(plan: BootstrapPlanLike): BillingCycleLike | null {
  return readBillingCycle(plan)
}

/**
 * @deprecated Prefer `planBillingCycle` when the interval count matters.
 * Returns only the interval name.
 */
export function planBillingInterval(plan: BootstrapPlanLike): string | null {
  return readBillingCycle(plan)?.interval ?? null
}

/** Compact cycle suffix for a price label, e.g. `/mo` or `/3 mo`. */
export function formatCycleSuffix(cycle: BillingCycleLike | null): string {
  if (!cycle) return ''
  const short = shortCycle(cycle.interval)
  if (cycle.count && cycle.count > 1) return `/${cycle.count} ${short}`
  return `/${short}`
}

/**
 * The fixed-commitment price label for a plan row or CTA.
 * Usage rates belong on the description line, not here.
 */
export function formatPlanPriceLabel(
  plan: BootstrapPlanLike,
  locale: string,
  pricingOption?: PlanPricingOption,
): string {
  const shape = planPricingShape(plan)
  switch (shape.shape) {
    case 'free':
      return 'Free'
    case 'usage':
      return 'Pay per use'
    case 'recurring':
    case 'hybrid': {
      const option = pricingOption ?? resolveBootstrapPlanPricing(plan)
      const amount = option.price ?? shape.headlineMinor
      const currency = option.currency.toUpperCase()
      const priceLabel = formatPrice(amount, currency, { locale, free: '' })
      return `${priceLabel}${formatCycleSuffix(shape.cycle)}`
    }
    case 'oneTime': {
      const option = pricingOption ?? resolveBootstrapPlanPricing(plan)
      const amount = option.price ?? shape.headlineMinor
      const currency = option.currency.toUpperCase()
      const priceLabel = formatPrice(amount, currency, { locale, free: '' })
      return `${priceLabel} once`
    }
  }
}

function singularMeterNoun(unit: string): string {
  if (unit.endsWith('ies')) return `${unit.slice(0, -3)}y`
  if (unit.endsWith('s') && !unit.endsWith('ss')) return unit.slice(0, -1)
  return unit
}

/**
 * What one metered call costs, as a label.
 *
 * Credits need the USD→charge-currency peg, which only `balance` carries,
 * so without one — or when the plan is priced in a different currency
 * than the balance — this falls back to the charge itself (`$0.02 / call`)
 * rather than inventing a credit figure.
 *
 * A tier-priced plan is read through `usageRate`, so it labels its ENTRY
 * band and says so ("from $0.02 / call"): later units are priced by their
 * own bands, and presenting the first band's rate bare would understate
 * a rising stack. Reading `perUnitCharge` alone — as this did — found
 * nothing on a tiered plan and rendered no rate at all.
 */
export function formatPaygRate(
  plan: BootstrapPlanLike,
  locale?: string,
  balance?: BalancePegLike | null,
): string | null {
  const rate = usageRate(plan)
  if (!rate || !(rate.amountMinor > 0)) return null
  const prefix = rate.tiered ? 'from ' : ''

  const credits = creditsPerUnitFromBalance(plan, balance)
  const unit = singularMeterNoun(rate.meter ?? meterName(plan) ?? 'unit')
  if (credits != null) {
    return `${prefix}${credits.toLocaleString(locale)} ${credits === 1 ? 'credit' : 'credits'} / ${unit}`
  }

  return `${prefix}${formatPrice(rate.amountMinor, rate.currency.toUpperCase(), { locale })} / ${unit}`
}

/**
 * The plan's per-cycle included allowance, counted in metered items — the
 * `limit` option's `cap`. `0` is the backend's "unlimited" sentinel, so
 * both it and an absent limit return `null`: neither is a number to show
 * as an allowance.
 */
export function inferIncludedUnits(plan: BootstrapPlanLike): number | null {
  const cap = includedUnits(plan)
  return cap != null && cap > 0 ? cap : null
}

/** The meter a plan counts against, for labelling an allowance. */
export function planMeterName(plan: BootstrapPlanLike): string | null {
  return meterName(plan)
}

export function shortCycle(cycle: string | null | undefined): string {
  if (!cycle) return ''
  const lc = cycle.toLowerCase()
  if (lc === 'week' || lc.startsWith('week')) return 'wk'
  if (lc === 'year' || lc.startsWith('year') || lc === 'annually' || lc === 'annual') return 'yr'
  if (lc === 'month' || lc.startsWith('month')) return 'mo'
  if (lc === 'day' || lc.startsWith('day')) return 'd'
  return cycle
}
