'use client'

/**
 * Step 1 — plan selection. One ordered column of `PlanRow`s. Back
 * link sits top-left above the heading. Selection changes only the
 * row border and check fill — the 20px check slot never reflows.
 *
 * When `fromPaywall` is `activation_required` the step names that a
 * plan is needed. `payment_required` is state F on the account
 * surface — this step no longer prefixes a limit-reached handoff.
 * `hideUpgradeBanner` suppresses the activation preface.
 */

import React, { memo } from 'react'
import { PlanSelector, usePlanSelector } from '../../../../primitives/PlanSelector'
import { useCopy } from '../../../../hooks/useCopy'
import { useBalance } from '../../../../hooks/useBalance'
import { useHostLocale } from '../../../useHostLocale'
import { BackLink } from '../../BackLink'
import type { BootstrapPlanLike, Cx } from '../shared'
import { formatContinueLabel } from '../shared'
import { CheckoutPlanRow } from '../CheckoutPlanRow'

interface PlanStepProps {
  fromPaywall: boolean
  paywallKind?: 'payment_required' | 'activation_required'
  /** Suppresses the inline upgrade preface even when `fromPaywall` is true. */
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
  const { selectedPlan, selectedPlanRef, getSelectedOption, plans, select, isCurrent, isFree } =
    usePlanSelector()
  const locale = useHostLocale()
  const copy = useCopy()
  const balance = useBalance()
  const selectedPlanShape = selectedPlan as unknown as BootstrapPlanLike | null
  const pricingOption = selectedPlan ? getSelectedOption(selectedPlan) : undefined
  const ctaLabel = formatContinueLabel(selectedPlanShape, locale, pricingOption)
  const showPreface = fromPaywall && !hideUpgradeBanner && paywallKind !== 'payment_required'

  return (
    <>
      {onBack ? <BackLink label={copy.checkout.backToAccount} onClick={onBack} /> : null}

      {showPreface ? (
        <p className={cx.muted} role="status">
          This tool needs a paid plan. Pick one to get started.
        </p>
      ) : null}

      <div className="solvapay-mcp-plan-step-header">
        <h2 className={cx.heading}>Choose a plan</h2>
        <PlanSelector.CurrencySwitcher className="solvapay-plan-selector-currency-switcher" />
      </div>

      <div className="solvapay-mcp-plan-list">
        {plans.map(plan => (
          <CheckoutPlanRow
            key={plan.reference}
            plan={plan}
            locale={locale}
            selected={selectedPlanRef === plan.reference}
            current={isCurrent(plan.reference)}
            free={isFree(plan.reference)}
            selectedOption={getSelectedOption(plan)}
            balance={balance}
            onSelect={() => select(plan.reference)}
          />
        ))}
      </div>
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
