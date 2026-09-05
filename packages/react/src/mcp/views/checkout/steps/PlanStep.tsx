'use client'

/**
 * Step 1 — plan selection. One ordered column of `PlanRow`s. Back
 * link sits top-left above the heading. Selection changes only the
 * row border and check fill — the 20px check slot never reflows.
 *
 * When `fromPaywall` is `payment_required` the step leads with the
 * reduced limit-reached handoff. `activation_required` still names
 * that a plan is needed. `hideUpgradeBanner` suppresses both.
 */

import React, { memo } from 'react'
import { PlanSelector, usePlanSelector } from '../../../../primitives/PlanSelector'
import { useCopy } from '../../../../hooks/useCopy'
import { useBalance } from '../../../../hooks/useBalance'
import { usePurchase } from '../../../../hooks/usePurchase'
import { useHostLocale } from '../../../useHostLocale'
import { formatPrice } from '../../../../utils/format'
import { isPaygPlan } from '../../../../utils/isPayg'
import { PlanRow } from '../../../primitives'
import { BackLink } from '../../BackLink'
import { McpLimitReached } from '../../McpLimitReached'
import type { BootstrapPlanLike, Cx } from '../shared'
import {
  formatContinueLabel,
  formatPaygRate,
  inferIncludedUnits,
  planBillingInterval,
  planMeterName,
  shortCycle,
} from '../shared'
import type { Plan } from '../../../../types'

interface PlanStepProps {
  fromPaywall: boolean
  paywallKind?: 'payment_required' | 'activation_required'
  /** Suppresses the inline limit / upgrade preface even when `fromPaywall` is true. */
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
  const { purchases } = usePurchase()
  const selectedPlanShape = selectedPlan as unknown as BootstrapPlanLike | null
  const pricingOption = selectedPlan ? getSelectedOption(selectedPlan) : undefined
  const ctaLabel = formatContinueLabel(selectedPlanShape, locale, pricingOption)
  const showPreface = fromPaywall && !hideUpgradeBanner
  const productName = purchases.find(purchase => purchase.productName)?.productName

  return (
    <>
      {onBack ? <BackLink label={copy.checkout.backToAccount} onClick={onBack} /> : null}

      {showPreface && paywallKind === 'payment_required' ? (
        <McpLimitReached productName={productName} onOpenAccount={onBack} />
      ) : null}

      {showPreface && paywallKind !== 'payment_required' ? (
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

function CheckoutPlanRow({
  plan,
  locale,
  selected,
  current,
  free,
  selectedOption,
  balance,
  onSelect,
}: {
  plan: Plan
  locale: string
  selected: boolean
  current: boolean
  free: boolean
  selectedOption: { price: number; currency: string }
  balance: ReturnType<typeof useBalance>
  onSelect: () => void
}) {
  const isPaygCurrent = current && isPaygPlan(plan)
  const disabled = free || (current && !isPaygCurrent)
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

function resolvePlanRowState({
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

function formatPlanPrice(
  option: { price: number; currency: string },
  locale: string,
  interval: string | null,
  payg: boolean,
): string {
  const priceLabel = formatPrice(option.price ?? 0, option.currency.toUpperCase(), { locale })
  if (payg || !interval) return priceLabel
  return `${priceLabel}/${shortCycle(interval)}`
}

function planWhatItGives(
  plan: Plan,
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
