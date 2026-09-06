'use client'

/**
 * Shared `PlanRow` binding for checkout step 1 and the A/F account ladder.
 * Selection only changes border and check fill. The parent decides
 * disabled / current / selected — checkout freezes Free, the account
 * ladder does not.
 */

import React from 'react'
import { useBalance } from '../../../hooks/useBalance'
import { isPaygPlan } from '../../../utils/isPayg'
import type { Plan } from '../../../types'
import { PlanRow } from '../../primitives'
import type { PlanLike } from '../../plan-actions'
import {
  formatPaygRate,
  formatPlanPriceLabel,
  inferIncludedUnits,
  planBillingCycle,
  planMeterName,
  formatCycleSuffix,
} from '../../../primitives/checkout/shared'

export type LadderPlan = PlanLike & {
  reference: string
  description?: string | null
}

export function CheckoutPlanRow({
  plan,
  locale,
  selected,
  current,
  free,
  selectedOption,
  balance,
  disabled: disabledOverride,
  description: descriptionOverride,
  onSelect,
}: {
  plan: LadderPlan
  locale: string
  selected: boolean
  current: boolean
  free: boolean
  selectedOption: { price: number; currency: string }
  balance: ReturnType<typeof useBalance>
  /** When omitted, Free and a non-PAYG current plan are disabled (checkout). */
  disabled?: boolean
  /** Fullscreen A supplies the longer consequence line. */
  description?: string
  onSelect: () => void
}): React.ReactElement {
  const isPaygCurrent = current && isPaygPlan(plan)
  const disabled = disabledOverride ?? (free || (current && !isPaygCurrent))
  const state = resolvePlanRowState({ current, selected, free, isPaygCurrent })
  const priceLabel = formatPlanPriceLabel(plan, locale, selectedOption)
  const description = descriptionOverride ?? planWhatItGives(plan, locale, balance)

  return (
    <PlanRow
      name={plan.name ?? plan.reference}
      description={description}
      price={priceLabel}
      selected={selected && !disabled}
      current={current}
      disabled={disabled}
      state={state}
      onClick={onSelect}
      data-free={free ? '' : undefined}
    />
  )
}

export function resolvePlanRowState({
  current,
  selected,
  free,
  isPaygCurrent,
}: {
  current: boolean
  selected: boolean
  free: boolean
  isPaygCurrent: boolean
}): 'idle' | 'selected' | 'current' | 'disabled' {
  if (current && !isPaygCurrent) return 'current'
  if (selected) return 'selected'
  if (current) return 'current'
  if (free) return 'disabled'
  return 'idle'
}

export function planWhatItGives(
  plan: LadderPlan | Plan,
  locale: string,
  balance: ReturnType<typeof useBalance>,
): string | undefined {
  if (plan.description) return plan.description
  const rate = formatPaygRate(plan, locale, balance)
  if (rate) return rate
  const included = inferIncludedUnits(plan)
  const meter = planMeterName(plan)
  if (included != null) {
    const noun = meter ?? 'included'
    const cycleSuffix = formatCycleSuffix(planBillingCycle(plan))
    return `${included.toLocaleString(locale)} ${noun}${cycleSuffix ? ` ${cycleSuffix}` : ''}`
  }
  return undefined
}
