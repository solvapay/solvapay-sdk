'use client'

/**
 * `<McpActivateView>` — the "activate a free / trial / usage-based plan"
 * screen surfaced by the `open_plan_activation` MCP tool.
 *
 * Happy path (free / trial / zero-priced plans):
 *   PlanSelector → ActivationFlow summary → ActivateButton → Activated.
 *
 * Usage-based plans requiring credits up-front run the inline
 * `ActivationFlow.AmountPicker` → `ContinueButton` → `Retrying` cycle.
 * The sub-picker shares its selector with the flow's top-level
 * `useTopupAmountSelector` (via the `selector` prop on
 * `AmountPicker.Root`), so the amount the user picks feeds straight into
 * `retry()`.
 */

import React from 'react'
import { usePurchase } from '../../hooks/usePurchase'
import { ActivationFlow } from '../../primitives/ActivationFlow'
import {
  AmountPicker,
  useAmountPicker,
} from '../../primitives/AmountPicker'
import { PlanSelector } from '../../primitives/PlanSelector'
import { resolveMcpClassNames, type McpViewClassNames } from './types'

export interface McpActivateViewProps {
  productRef: string
  onActivated?: () => void
  classNames?: McpViewClassNames
}

export function McpActivateView({
  productRef,
  onActivated,
  classNames,
}: McpActivateViewProps) {
  const cx = resolveMcpClassNames(classNames)
  const { loading, hasPaidPurchase } = usePurchase()

  if (loading) {
    return (
      <div className={cx.card}>
        <p>Loading plans…</p>
      </div>
    )
  }

  if (hasPaidPurchase) {
    return (
      <div className={cx.card}>
        <h2 className={cx.heading}>{"You're already subscribed"}</h2>
        <p className={cx.muted}>
          You already have an active plan. Manage it from the account view instead.
        </p>
      </div>
    )
  }

  return (
    <div className={cx.card}>
      <h2 className={cx.heading}>Activate your plan</h2>
      <PlanSelector.Root productRef={productRef} className="solvapay-plan-selector">
        <PlanSelector.Grid className="solvapay-plan-selector-grid">
          <PlanSelector.Card className="solvapay-plan-selector-card">
            <PlanSelector.CardBadge className="solvapay-plan-selector-card-badge" />
            <PlanSelector.CardName className="solvapay-plan-selector-card-name" />
            <PlanSelector.CardPrice className="solvapay-plan-selector-card-price" />
            <PlanSelector.CardInterval className="solvapay-plan-selector-card-interval" />
          </PlanSelector.Card>
        </PlanSelector.Grid>
        <PlanSelector.Loading className="solvapay-plan-selector-loading" />
        <PlanSelector.Error className="solvapay-plan-selector-error" />

        <ActivationFlow.Root
          productRef={productRef}
          className={cx.activationFlow}
          onSuccess={() => onActivated?.()}
        >
          <ActivationFlow.Loading>
            <p className={cx.muted}>Loading plan…</p>
          </ActivationFlow.Loading>

          <ActivationFlow.Summary>
            <p className={cx.muted}>
              No payment is collected up front for free or trial plans — just confirm to activate.
            </p>
          </ActivationFlow.Summary>
          <ActivationFlow.ActivateButton className={cx.button} />

          <ActivationFlow.AmountPicker>
            <p className={cx.muted}>
              This plan meters usage. Pick a starting credit amount to activate.
            </p>
            <QuickAmountOptions cx={cx} />
            <AmountPicker.Custom className={cx.amountCustom} />
          </ActivationFlow.AmountPicker>
          <ActivationFlow.ContinueButton className={cx.button} />

          <ActivationFlow.Retrying>
            <p className={cx.muted}>Finishing activation…</p>
          </ActivationFlow.Retrying>

          <ActivationFlow.Activated>
            <p>{"Plan activated. You're all set."}</p>
          </ActivationFlow.Activated>

          <ActivationFlow.Error className={cx.error} />
        </ActivationFlow.Root>
      </PlanSelector.Root>
    </div>
  )
}

function QuickAmountOptions({ cx }: { cx: ReturnType<typeof resolveMcpClassNames> }) {
  const { quickAmounts } = useAmountPicker()
  return (
    <div className={cx.amountOptions}>
      {quickAmounts.map(amount => (
        <AmountPicker.Option key={amount} amount={amount} className={cx.amountOption} />
      ))}
    </div>
  )
}
