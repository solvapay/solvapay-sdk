/**
 * Pure account-widget state machine + field resolvers.
 *
 * `resolveAccountState()` maps bootstrap + limits onto the ten v3
 * states (A–J). The six field resolvers pin renderings that would
 * otherwise be re-decided per component. No React — same pattern as
 * `plan-actions.ts`.
 */

import {
  billingCycle,
  creditsPerUnitFromBalance,
  includedUnits,
  resolveAccountState as resolveAccountStateCore,
  usageRate,
  type BalancePegLike,
  type PricedLike,
} from '@solvapay/core'
import { resolvePlanShape, type PlanLike, type PlanShape } from './plan-actions'

export const ACCOUNT_STATES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] as const
export type AccountState = (typeof ACCOUNT_STATES)[number]

export interface AccountLimitsLike {
  remaining: number | null
  withinLimits: boolean | null
  activationRequired: boolean | null
  overage: boolean | null
  needsTopUp: boolean | null
  needsUpgrade: boolean | null
  throttled: boolean | null
}

export interface AccountPurchaseLike {
  planSnapshot?: PlanLike | null
  cancelledAt?: string | null
  endDate?: string | null
  usage?: { used?: number; periodEnd?: string | null } | null
}

export interface AccountStateInput {
  /** Bootstrap / limits still in flight — state G. */
  loading?: boolean
  purchase: AccountPurchaseLike | null | undefined
  limits: AccountLimitsLike | null | undefined
  /**
   * Pre-resolved shape. When omitted, derived from `purchase.planSnapshot`.
   * Callers that have the live catalog should pass `resolvePlanShape(mergePlanSnapshot(...))`.
   */
  planShape?: PlanShape | null
  now?: Date
}

/**
 * Precedence (pinned in tests):
 *   G loading
 *   H `activationRequired` (outranks zero remaining → not F)
 *   J `cancelledAt` + future `endDate` (outranks plan shape)
 *   I `overage` (outranks `withinLimits` → not F)
 *   D `needsTopUp` or a usage-based plan that is out of limits
 *   F allowance plan at cap
 *   B / C / E running plan-shape (`throttled` / `needsUpgrade` land here)
 *   A no plan
 */
export function resolveAccountState(input: AccountStateInput): AccountState {
  const result = resolveAccountStateCore({
    loading: input.loading,
    purchase: input.purchase ?? null,
    limits: input.limits ?? null,
    planShape: input.planShape ?? null,
    nowMs: (input.now ?? new Date()).getTime(),
  })
  return result as AccountState
}

// ---------------------------------------------------------------------------
// Field resolvers (v3 "Field renderings")
// ---------------------------------------------------------------------------

export type RemainingDisplay =
  | { kind: 'unknown'; label: 'Not known yet' }
  | { kind: 'unlimited'; label: 'Unlimited' }
  | { kind: 'finite'; remaining: number }

export function resolveRemaining(input: {
  remaining: number | null | undefined
  /** Plan limit cap. `0` means unlimited (backend sentinel). */
  cap?: number | null
  limitsResolved: boolean
}): RemainingDisplay {
  if (!input.limitsResolved) return { kind: 'unknown', label: 'Not known yet' }
  if (input.cap === 0 || input.remaining === -1) {
    return { kind: 'unlimited', label: 'Unlimited' }
  }
  if (input.remaining === null || input.remaining === undefined) {
    return { kind: 'unknown', label: 'Not known yet' }
  }
  return { kind: 'finite', remaining: input.remaining }
}

export type MeterTone = 'ok' | 'warning' | 'critical'

/**
 * Warning at 80% used **or** last remaining call (`remaining === 1` on a
 * finite cap). Critical at 100%. E at 2 of 3 is the last-call case.
 */
export function resolveMeterTone(input: {
  used: number
  remaining: number | null
  total: number | null
}): MeterTone {
  const finite = input.remaining !== null && input.remaining !== -1
  if (finite && input.remaining === 0) return 'critical'
  if (finite && input.remaining === 1) return 'warning'
  if (input.total !== null && input.total > 0) {
    const percent = Math.min(100, Math.round((input.used / input.total) * 10000) / 100)
    if (percent >= 100) return 'critical'
    if (percent >= 80) return 'warning'
  }
  return 'ok'
}

export type RateDisplay =
  | { kind: 'none'; label: null; showRunway: false }
  | { kind: 'unconvertible'; label: 'Rate confirmed at checkout'; showRunway: false }
  | { kind: 'flat'; creditsPerCall: number; label: string; showRunway: true }
  | { kind: 'tiered'; creditsPerCall: number; label: string; showRunway: true }

export function resolveRateDisplay(
  plan: PricedLike | null | undefined,
  balance: BalancePegLike | null | undefined,
  meter?: string,
): RateDisplay {
  const rate = usageRate(plan, meter)
  if (!rate) return { kind: 'none', label: null, showRunway: false }

  const credits = creditsPerUnitFromBalance(plan, balance, meter)
  if (credits === null) {
    return { kind: 'unconvertible', label: 'Rate confirmed at checkout', showRunway: false }
  }

  if (rate.tiered) {
    return {
      kind: 'tiered',
      creditsPerCall: credits,
      label: `from ${credits} credits per call`,
      showRunway: true,
    }
  }
  return {
    kind: 'flat',
    creditsPerCall: credits,
    label: `${credits} credits per call`,
    showRunway: true,
  }
}

export type PeriodDisplay =
  | { kind: 'none'; label: 'After your first call' }
  | { kind: 'date'; periodEnd: string }

export function resolvePeriodDisplay(periodEnd?: string | null): PeriodDisplay {
  if (!periodEnd) return { kind: 'none', label: 'After your first call' }
  return { kind: 'date', periodEnd }
}

export interface OneTimeDisplay {
  showRenews: boolean
  planQualifier: 'one time' | null
}

export function resolveOneTimeDisplay(plan: PricedLike | null | undefined): OneTimeDisplay {
  if (billingCycle(plan)) return { showRenews: true, planQualifier: null }
  // PAYG has no cycle either, but it is not a one-time purchase.
  if (resolvePlanShape(plan as PlanLike) === 'usage-based') {
    return { showRenews: false, planQualifier: null }
  }
  return { showRenews: false, planQualifier: 'one time' }
}

/**
 * The Sold-by strip is host chrome. No account state depends on it
 * being visible — provenance rides on the plan line.
 */
export function resolveMerchantStrip(): { required: false } {
  return { required: false }
}

export function remainingCap(plan: PricedLike | null | undefined, meter?: string): number | null {
  return includedUnits(plan, meter)
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Whole days from `now` until `iso`. Floor at 0 so a past reset never
 * prints a negative caption. `null` when the date is unparseable.
 */
export function daysUntil(iso: string, now: Date = new Date()): number | null {
  const end = new Date(iso)
  if (Number.isNaN(end.getTime())) return null
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / MS_PER_DAY))
}

/**
 * Display noun for an allowance meter. The default `requests` meter
 * reads as "calls" on this widget; any other meter keeps its name.
 */
export function allowanceMeterUnit(meter: string | null | undefined, count: number): string {
  if (meter && meter !== 'requests') {
    return count === 1 && meter.endsWith('s') ? meter.slice(0, -1) : meter
  }
  return count === 1 ? 'call' : 'calls'
}
