/**
 * Shared types and pure helpers for the checkout primitive.
 *
 * Consumed by `useCheckoutFlow` and the `CheckoutSteps.*` parts. No
 * side-effects, no React imports — keeps the helpers reusable from
 * the MCP wrapper and any custom integrator surface that wants to
 * build its own layout on top of `useCheckoutFlow`.
 */

import type { Plan } from '../../types'
import { formatPrice } from '../../utils/format'
import { isPaygPlan } from '../../utils/isPayg'
import { resolvePlanPricingOption, type PlanPricingOption } from '../../utils/planPricing'

export type CheckoutStep = 'plan' | 'amount' | 'payment' | 'success'

export const CHECKOUT_STEPS = ['plan', 'amount', 'payment', 'success'] as const

/**
 * Structural subset of a bootstrap plan. Kept here so step components
 * can type against it without pulling in the full `@solvapay/mcp`
 * bootstrap types (which would create a dep cycle).
 */
export interface BootstrapPlanLike {
  reference?: string
  name?: string
  type?: string
  planType?: string
  price?: number
  currency?: string
  billingCycle?: string | null
  meterRef?: string | null
  creditsPerUnit?: number | null
  requiresPayment?: boolean
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
      amountMinor: number
      currency: string
      creditsAdded: number
      plan: BootstrapPlanLike
      rateLabel: string
    }
  | {
      branch: 'recurring'
      plan: BootstrapPlanLike
      creditsIncluded: number
      chargedTodayMinor: number
      currency: string
      nextRenewalLabel: string | null
    }

export function isPayg(plan: BootstrapPlanLike | null | undefined): boolean {
  return isPaygPlan(plan ?? null)
}

/** Sort PAYG first, then recurring ascending by price. */
export function planSortByPaygFirstThenAsc(a: Plan, b: Plan): number {
  const aPayg = isPayg(a as unknown as BootstrapPlanLike)
  const bPayg = isPayg(b as unknown as BootstrapPlanLike)
  if (aPayg && !bPayg) return -1
  if (!aPayg && bPayg) return 1
  return (a.price ?? 0) - (b.price ?? 0)
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
    p => p.requiresPayment !== false && !isPayg(p as unknown as BootstrapPlanLike),
  )
  return plan => {
    if (plan.requiresPayment === false) return false
    if (hasNonPaygPaid && isPayg(plan as unknown as BootstrapPlanLike)) return false
    return true
  }
}

export function formatContinueLabel(
  plan: BootstrapPlanLike | null,
  locale?: string,
  pricingOption?: PlanPricingOption,
): string {
  if (!plan) return 'Continue'
  if (isPayg(plan)) {
    return `Continue with ${plan.name ?? 'Pay as you go'}`
  }
  const option =
    pricingOption ?? resolvePlanPricingOption(plan as unknown as Plan, null)
  const currency = option.currency.toUpperCase()
  const priceLabel = formatPrice(option.price ?? 0, currency, { locale })
  const cycle = plan.billingCycle ? `/${shortCycle(plan.billingCycle)}` : ''
  return `Continue with ${plan.name ?? 'Plan'} — ${priceLabel}${cycle}`
}

export function formatPaygRate(plan: BootstrapPlanLike, locale?: string): string {
  const currency = (plan.currency ?? 'USD').toUpperCase()
  const creditsPerUnit = plan.creditsPerUnit ?? 1
  // One currency unit per credit at the plan's rate. Minor-unit
  // representation: 1 credit = 1 / creditsPerUnit of a minor unit.
  const perCreditMinor = Math.max(1, Math.round(1 / creditsPerUnit))
  return `${formatPrice(perCreditMinor, currency, { locale })} / call`
}

export function inferIncludedCredits(plan: BootstrapPlanLike): number {
  const price = plan.price ?? 0
  const creditsPerUnit = plan.creditsPerUnit ?? 0
  if (price > 0 && creditsPerUnit > 0) {
    return Math.round(price * creditsPerUnit)
  }
  return 0
}

export function shortCycle(cycle: string | null | undefined): string {
  if (!cycle) return 'mo'
  const lc = cycle.toLowerCase()
  if (lc.startsWith('year') || lc === 'annually' || lc === 'annual') return 'yr'
  if (lc.startsWith('week')) return 'wk'
  if (lc.startsWith('day')) return 'd'
  return 'mo'
}
