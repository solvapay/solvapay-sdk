/**
 * A/F ladder copy — what happens at the limit, and whether a card is
 * needed. Delegates to `@solvapay/core`.
 */

import { planConsequence as planConsequenceCore, type BalancePegLike } from '@solvapay/core'
import { type PlanLike } from './plan-actions'

export function planConsequence(
  plan: PlanLike,
  locale: string,
  balance: BalancePegLike | null | undefined,
  extras: { merchantName?: string | null } = {},
): string {
  const result = planConsequenceCore(plan, locale, balance, extras.merchantName ?? null)
  if (typeof result === 'string') return result
  const details =
    result && typeof result === 'object' && 'details' in result
      ? String((result as { details: unknown }).details)
      : 'planConsequence failed'
  throw new Error(details)
}
