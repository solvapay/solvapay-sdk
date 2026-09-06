'use client'

/**
 * Shared `PlanRow` binding for checkout step 1 and the A/F account ladder.
 * Selection only changes border and check fill. The parent decides
 * disabled / current / selected — checkout freezes Free, the account
 * ladder does not.
 */

import React from 'react'
import { useBalance } from '../../../hooks/useBalance'
import { formatPrice } from '../../../utils/format'
import { isPaygPlan } from '../../../utils/isPayg'
import type { Plan } from '../../../types'
import { PlanRow } from '../../primitives'
import type { PlanLike } from '../../plan-actions'
import {
  formatPaygRate,
  inferIncludedUnits,
  planBillingInterval,
  planMeterName,
  shortCycle,
} from './shared'

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
  onSelect: () => void
}): React.ReactElement {
  const isPaygCurrent = current && isPaygPlan(plan)
  const disabled = disabledOverride ?? (free || (current && !isPaygCurrent))
  const state = resolvePlanRowState({ current, selected, free, isPaygCurrent })
  const interval = planBillingInterval(plan)
  const priceLabel = formatPlanPrice(selectedOption, locale, interval, isPaygPlan(plan))
  const description = planWhatItGives(plan, locale, balance)

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
      data-solvapay-plan-selector-card=""
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

export function formatPlanPrice(
  option: { price: number; currency: string },
  locale: string,
  interval: string | null,
  payg: boolean,
): string {
  const priceLabel = formatPrice(option.price ?? 0, option.currency.toUpperCase(), { locale })
  if (payg || !interval) return priceLabel
  return `${priceLabel}/${shortCycle(interval)}`
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
    return `${included.toLocaleString(locale)} ${noun}`
  }
  return undefined
}
