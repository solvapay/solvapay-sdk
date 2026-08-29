import {
  billingCycle as readBillingCycle,
  countsUsage,
  creditsPerUnitFromBalance,
  includedUnits,
  meterName,
  perUnitCharge,
  trialDays,
  type BalancePegLike,
  type BillingInterval,
  type Charge,
  type PricedLike,
} from '@solvapay/core'

export type PlanDisplayBlock = {
  billingCycle?: { interval: BillingInterval; count?: number } | null
  countsUsage?: boolean
  includedUnits?: number | null
  meterName?: string | null
  perUnitCharge?: Charge | null
  creditsPerUnit?: number | null
  trialDays?: number | null
}

export type PlanWithDisplay = PricedLike & {
  display?: PlanDisplayBlock | null
  isMetered?: boolean | null
  requiresPayment?: boolean | null
  price?: number | null
}

export function planHasDisplay(plan: PlanWithDisplay | null | undefined): boolean {
  return plan?.display != null
}

export function planCountsUsage(plan: PlanWithDisplay | null | undefined): boolean {
  if (!plan) return false
  if (typeof plan.display?.countsUsage === 'boolean') {
    return plan.display.countsUsage || plan.isMetered === true
  }
  return countsUsage(plan) || plan.isMetered === true
}

export function planTrialDays(plan: PlanWithDisplay | null | undefined): number {
  if (planHasDisplay(plan)) return plan?.display?.trialDays ?? 0
  return trialDays(plan) ?? 0
}

export function planBillingCycleInterval(
  plan: PlanWithDisplay | null | undefined,
): BillingInterval | null {
  if (planHasDisplay(plan)) return plan?.display?.billingCycle?.interval ?? null
  return readBillingCycle(plan)?.interval ?? null
}

export function planIncludedUnits(plan: PlanWithDisplay | null | undefined): number | null {
  if (planHasDisplay(plan)) {
    const cap = plan?.display?.includedUnits
    return cap != null && cap > 0 ? cap : null
  }
  const cap = includedUnits(plan)
  return cap != null && cap > 0 ? cap : null
}

export function planMeterNameValue(plan: PlanWithDisplay | null | undefined): string | null {
  if (planHasDisplay(plan)) return plan?.display?.meterName ?? null
  return meterName(plan)
}

export function planPerUnitCharge(plan: PlanWithDisplay | null | undefined): Charge | null {
  if (planHasDisplay(plan)) return plan?.display?.perUnitCharge ?? null
  return perUnitCharge(plan)
}

export function planCreditsPerUnit(
  plan: PlanWithDisplay | null | undefined,
  balance?: BalancePegLike | null,
): number | null {
  if (planHasDisplay(plan) && plan?.display?.creditsPerUnit != null) {
    return plan.display.creditsPerUnit
  }
  if (planHasDisplay(plan)) return null
  return creditsPerUnitFromBalance(plan, balance)
}
