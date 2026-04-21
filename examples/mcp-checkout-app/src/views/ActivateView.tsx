/**
 * ActivateView — the "activate a free/trial/zero-priced plan" screen
 * surfaced by the `open_plan_activation` MCP tool.
 *
 * Happy path (free / trial / zero-priced plans):
 *   PlanSelector → ActivationFlow summary → ActivateButton → Activated.
 *
 * Usage-based plans that require credits up-front transition through
 * `selectAmount` / `topupPayment` / `retrying` steps. The current
 * `ActivationFlow.AmountPicker` primitive mounts its own
 * `AmountPicker.Root` with an independent `useTopupAmountSelector`
 * instance, so the amount the user picks in that sub-picker does not
 * feed back into the flow's retry amount — a known SDK seam. Rather
 * than shipping a buggy inline top-up, we surface a clear fallback that
 * points the customer at `open_topup` / the hosted portal when the flow
 * reports `error`. That keeps this prototype honest about what works
 * today and gives the follow-up plan a concrete "lift into SDK" target:
 * fix the primitive so flow + picker share one selector.
 */

import React from 'react'
import { ActivationFlow, PlanSelector } from '@solvapay/react/primitives'
import { usePurchase } from '@solvapay/react'

type ActivateViewProps = {
  productRef: string
}

export function ActivateView({ productRef }: ActivateViewProps) {
  const { loading, hasPaidPurchase } = usePurchase()

  if (loading) {
    return (
      <div className="checkout-card">
        <p>Loading plans…</p>
      </div>
    )
  }

  if (hasPaidPurchase) {
    return (
      <div className="checkout-card">
        <h2>You're already subscribed</h2>
        <p className="checkout-muted">
          You already have an active plan. Manage it from the account view instead.
        </p>
      </div>
    )
  }

  return (
    <div className="checkout-card">
      <h2>Activate your plan</h2>
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

        <ActivationFlow.Root productRef={productRef} className="activation-flow">
          <ActivationFlow.Loading>
            <p className="checkout-muted">Loading plan…</p>
          </ActivationFlow.Loading>

          <ActivationFlow.Summary>
            <p className="checkout-muted">
              No payment is collected up front for free or trial plans — just confirm to activate.
            </p>
          </ActivationFlow.Summary>
          <ActivationFlow.ActivateButton className="hosted-button" />

          <ActivationFlow.Retrying>
            <p className="checkout-muted">Finishing activation…</p>
          </ActivationFlow.Retrying>

          <ActivationFlow.Activated>
            <p>Plan activated. You're all set.</p>
          </ActivationFlow.Activated>

          {/*
            Usage-based fallback. When the SDK transitions into
            `selectAmount` / `topupPayment` we render guidance instead of
            an inline top-up — see the module header for why.
          */}
          <UsageBasedFallback />

          <ActivationFlow.Error className="checkout-error" />
        </ActivationFlow.Root>
      </PlanSelector.Root>
    </div>
  )
}

import { useActivationFlow } from '@solvapay/react/primitives'

function UsageBasedFallback() {
  const flow = useActivationFlow()
  if (flow.step !== 'selectAmount' && flow.step !== 'topupPayment') return null
  return (
    <div className="checkout-notice">
      <p>
        <strong>This plan needs credits to activate.</strong>
      </p>
      <p>
        Top up from the SolvaPay account view, then come back here to activate.
      </p>
    </div>
  )
}
