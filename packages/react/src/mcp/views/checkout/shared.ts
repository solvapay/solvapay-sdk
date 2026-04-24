/**
 * Shared types and pure helpers for the MCP checkout state machine.
 *
 * The plan → amount → payment → success flow is used by both
 * `<McpCheckoutView>` (the `activate_plan` surface) and
 * `<McpPaywallView>` (the paywall surface) so the helpers live in a
 * dedicated module to keep the state machine and step components slim.
 */

import type { Plan } from '../../../types'
import { formatPrice } from '../../../utils/format'
import { isPaygPlan } from '../../../utils/isPayg'
import { resolveMcpClassNames } from '../types'

export type Cx = ReturnType<typeof resolveMcpClassNames>

export type Step = 'plan' | 'amount' | 'payment' | 'success'

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

/** Sort PAYG first, then recurring ascending by price — matches the brief's wireframe. */
export function planSortByPaygFirstThenAsc(a: Plan, b: Plan): number {
  const aPayg = isPayg(a as unknown as BootstrapPlanLike)
  const bPayg = isPayg(b as unknown as BootstrapPlanLike)
  if (aPayg && !bPayg) return -1
  if (!aPayg && bPayg) return 1
  return (a.price ?? 0) - (b.price ?? 0)
}

export function formatContinueLabel(plan: BootstrapPlanLike | null, locale?: string): string {
  if (!plan) return 'Continue'
  if (isPayg(plan)) {
    return `Continue with ${plan.name ?? 'Pay as you go'}`
  }
  const currency = (plan.currency ?? 'USD').toUpperCase()
  const priceLabel = formatPrice(plan.price ?? 0, currency, { locale })
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
  // Best-effort: for recurring-unlimited-with-included-credits, the
  // server surfaces this via a dedicated field in future revisions;
  // V1 relies on `creditsPerUnit` × price (minor units) as a fallback.
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
