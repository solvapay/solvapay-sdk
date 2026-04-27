'use client'

/**
 * Step 1 — plan selection. Renders the `PlanSelector` grid and a
 * primary `Continue with …` CTA that stays disabled until a plan is
 * selected.
 *
 * When `fromPaywall` is true the step assumes it owns the "you hit a
 * paywall" reason copy and prefaces the grid with an `UpgradeBanner`.
 * `hideUpgradeBanner` overrides that — set it from custom surfaces
 * that already provide the reason copy outside the step (e.g. a
 * consumer wrapping the state machine in their own `<PaywallNotice>`
 * which already renders a heading + message).
 */

import React, { memo } from 'react'
import { PlanSelector, usePlanSelector } from '../../../../primitives/PlanSelector'
import { useCopy } from '../../../../hooks/useCopy'
import { useHostLocale } from '../../../useHostLocale'
import { BackLink } from '../../BackLink'
import type { BootstrapPlanLike, Cx } from '../shared'
import { formatContinueLabel } from '../shared'

interface PlanStepProps {
  fromPaywall: boolean
  paywallKind?: 'payment_required' | 'activation_required'
  /** Suppresses the inline `UpgradeBanner` even when `fromPaywall` is true. */
  hideUpgradeBanner?: boolean
  onContinue: () => void
  onStayOnFree?: () => void
  /**
   * Called when the user picks "Back to my account" at the top of
   * the plan picker. Wired by `<McpAppShell>` whenever the shell
   * owns surface routing — mirrors the topup view's back-link.
   */
  onBack?: () => void
  isActivating: boolean
  activationError: string | null
  cx: Cx
}

export const PlanStep = memo(function PlanStep({
  fromPaywall,
  paywallKind,
  hideUpgradeBanner,
  onContinue,
  onStayOnFree,
  onBack,
  isActivating,
  activationError,
  cx,
}: PlanStepProps) {
  const { selectedPlan, selectedPlanRef } = usePlanSelector()
  const locale = useHostLocale()
  const copy = useCopy()
  const selectedPlanShape = selectedPlan as unknown as BootstrapPlanLike | null
  const ctaLabel = formatContinueLabel(selectedPlanShape, locale)
  const showBanner = fromPaywall && !hideUpgradeBanner

  return (
    <>
      {onBack ? <BackLink label={copy.checkout.backToAccount} onClick={onBack} /> : null}

      {showBanner ? <UpgradeBanner kind={paywallKind} cx={cx} /> : null}

      <h2 className={cx.heading}>Choose a plan</h2>

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

      {activationError ? (
        <p className={cx.error} role="alert">
          {activationError}
        </p>
      ) : null}

      <button
        type="button"
        className={cx.button}
        disabled={!selectedPlanRef || isActivating}
        aria-disabled={!selectedPlanRef || isActivating}
        onClick={onContinue}
      >
        {ctaLabel}
      </button>

      {onStayOnFree ? (
        <button
          type="button"
          className={`${cx.linkButton ?? ''} solvapay-mcp-checkout-dismiss`.trim()}
          onClick={onStayOnFree}
          data-solvapay-mcp-checkout-stay-on-free=""
        >
          Stay on Free
        </button>
      ) : null}
    </>
  )
})

function UpgradeBanner({
  kind,
  cx,
}: {
  kind?: 'payment_required' | 'activation_required'
  cx: Cx
}) {
  // `payment_required` fires when the customer's active plan hit its
  // limit (quota exhausted on Free); `activation_required` fires when
  // no paid plan is active and the tool requires one.
  const copy =
    kind === 'payment_required'
      ? "You've used your free quota. Pick a plan to keep going."
      : 'This tool needs a paid plan. Pick one to get started.'
  return (
    <div
      className="solvapay-mcp-checkout-banner"
      role="status"
      data-solvapay-mcp-checkout-banner=""
    >
      <strong className="solvapay-mcp-checkout-banner-title">Upgrade to continue</strong>
      <span className={`${cx.muted} solvapay-mcp-checkout-banner-message`.trim()}>{copy}</span>
    </div>
  )
}
