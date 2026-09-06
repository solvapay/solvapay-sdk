/**
 * Fullscreen A ladder copy — what happens at the limit, and whether a
 * card is needed. Widget A keeps the shorter `planWhatItGives` rows.
 */

import {
  billingCycle,
  creditsPerUnitFromBalance,
  meterName,
  type BalancePegLike,
} from '@solvapay/core'
import { allowanceMeterUnit, remainingCap, resolveOneTimeDisplay } from './account-state'
import { resolvePlanShape, type PlanLike } from './plan-actions'

export function planConsequence(
  plan: PlanLike,
  locale: string,
  balance: BalancePegLike | null | undefined,
  extras: { merchantName?: string | null } = {},
): string {
  const shape = resolvePlanShape(plan)
  const meter = meterName(plan)
  const interval = billingCycle(plan)?.interval ?? 'month'

  if (shape === 'usage-based') {
    return paygConsequence(plan, locale, balance, extras.merchantName)
  }

  const cap = remainingCap(plan)
  const finite = cap != null && cap > 0
  const unit = allowanceMeterUnit(meter, finite ? cap : 2)
  const oneTime = resolveOneTimeDisplay(plan)

  if (shape === 'free' || shape === 'trial') {
    if (!finite) {
      throw new Error(`Free/trial plan ${plan.reference ?? plan.name} has no finite cap`)
    }
    const total = new Intl.NumberFormat(locale).format(cap)
    return `${total} ${unit} per ${interval}, then calls fail. No card needed.`
  }

  if (finite) {
    const total = new Intl.NumberFormat(locale).format(cap)
    return `${total} ${unit} per ${interval}. No credits used. Cancel any time.`
  }

  if (oneTime.planQualifier) {
    return `Unlimited ${unit}, one time. No credits used, no renewal.`
  }

  return `Unlimited ${unit}. No credits used. Cancel any time.`
}

function paygConsequence(
  plan: PlanLike,
  locale: string,
  balance: BalancePegLike | null | undefined,
  merchantName?: string | null,
): string {
  const credits = creditsPerUnitFromBalance(plan, balance)
  const across = merchantName
    ? ` Credits work across every ${merchantName} product.`
    : ''
  if (credits == null) {
    return `Drawn from your credit balance.${across}`
  }
  const formatted = credits.toLocaleString(locale)
  return `From ${formatted} credits per call, drawn from your credit balance.${across}`
}
