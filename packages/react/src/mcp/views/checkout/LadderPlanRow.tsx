'use client'

/**
 * Action-button binding for the A/F account ladder. Checkout's
 * select-then-continue `PlanStep` still uses `CheckoutPlanRow`.
 */

import React from 'react'
import { headlineCharges } from '@solvapay/core'
import { useBalance } from '../../../hooks/useBalance'
import { PlanActionRow } from '../../primitives'
import { formatPlanPriceLabel } from '../../../primitives/checkout/shared'
import { planConsequence } from '../../plan-consequence'
import type { PlanLike } from '../../plan-actions'
import type { LadderPlan } from './CheckoutPlanRow'

export function LadderPlanRow({
  plan,
  locale,
  emphasized,
  actionLabel,
  busy,
  disabled,
  merchantName,
  onAction,
}: {
  plan: LadderPlan
  locale: string
  emphasized: boolean
  actionLabel: string
  busy?: boolean
  disabled?: boolean
  merchantName?: string | null
  onAction: () => void
}): React.ReactElement {
  const balance = useBalance()
  const option = optionFromPlan(plan)
  const title = ladderTitle(plan, locale, option)
  const description = planConsequence(plan, locale, balance, { merchantName })

  return (
    <PlanActionRow
      title={title}
      description={description}
      actionLabel={actionLabel}
      emphasis={emphasized ? 'primary' : 'secondary'}
      busy={busy}
      disabled={disabled}
      onAction={onAction}
    />
  )
}

function ladderTitle(
  plan: LadderPlan,
  locale: string,
  option: { price: number; currency: string },
): string {
  const name = plan.name ?? plan.reference
  const price = formatPlanPriceLabel(plan, locale, option)
  if (price === 'Free' || price === 'Pay per use') return name
  return `${name} · ${price}`
}

function optionFromPlan(plan: PlanLike): { price: number; currency: string } {
  const headline = headlineCharges(plan)[0]
  return {
    price: headline?.amountMinor ?? plan.price ?? 0,
    currency: headline?.currency ?? plan.currency ?? 'usd',
  }
}
