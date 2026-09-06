'use client'

/**
 * Account states A (no plan) and F (allowance at cap).
 *
 * One family: a `PlanActionRow` ladder. A is the whole widget. F
 * suppresses the balance box, drops Change plan, and states the credit
 * trap when credits cannot restore calls. PAYG is emphasized when its
 * activation strategy is `topup-first`. Each row's button activates in
 * place when no payment is needed, or swaps to checkout with that plan
 * when it is.
 */

import React, { useEffect, useState } from 'react'
import { billingCycle, includedUnits } from '@solvapay/core'
import type { BootstrapProduct } from '@solvapay/mcp-core'
import { LaunchCustomerPortalButton } from '../../components/LaunchCustomerPortalButton'
import { useActivation } from '../../hooks/useActivation'
import { useBalance } from '../../hooks/useBalance'
import { useCopy } from '../../hooks/useCopy'
import { useMerchant } from '../../hooks/useMerchant'
import { useUsage } from '../../hooks/useUsage'
import { interpolate } from '../../i18n/interpolate'
import { allowanceMeterUnit, daysUntil, remainingCap, resolvePeriodDisplay } from '../account-state'
import { formatShortDate, type ActiveProduct } from '../derive-active-products'
import { useDisplayMode } from '../hooks/useDisplayMode'
import {
  resolveActivationStrategy,
  resolvePlanShape,
  type PlanLike,
  type PlanShape,
} from '../plan-actions'
import { Eyebrow, Section } from '../primitives'
import { AccountIdentityFooter } from './accountFullscreen'
import { PlanIdentityHeader } from './accountViewShared'
import { LadderPlanRow } from './checkout/LadderPlanRow'
import type { LadderPlan } from './checkout/CheckoutPlanRow'
import { resolveMcpClassNames, type McpViewClassNames } from './types'

export function LadderAccountPanel({
  accountState,
  product,
  allowanceProduct,
  planForActions,
  planShape,
  plans,
  productRef,
  locale,
  classNames,
  onChangePlan,
  showPortalCta,
}: {
  accountState: 'A' | 'F'
  product?: Pick<BootstrapProduct, 'name' | 'description'> | null
  allowanceProduct?: ActiveProduct
  planForActions: PlanLike | null
  planShape: PlanShape | null
  plans?: readonly PlanLike[]
  productRef?: string
  locale: string
  classNames?: McpViewClassNames
  onChangePlan?: (planRef?: string) => void
  showPortalCta: boolean
}): React.ReactElement {
  const cx = resolveMcpClassNames(classNames)
  const copy = useCopy()
  const balance = useBalance()
  const { merchant } = useMerchant()
  const { displayMode } = useDisplayMode()
  const isFullscreen = displayMode === 'fullscreen' && accountState === 'A'
  const { usage } = useUsage()
  const { activate, state, error } = useActivation()
  const credits = balance.credits ?? 0
  const [pendingRef, setPendingRef] = useState<string | null>(null)

  const ladderPlans = listLadderPlans(plans, {
    excludeRef: accountState === 'F' ? allowanceProduct?.planRef : null,
    excludeFree: accountState === 'F',
  })
  const emphasizedRef = ladderPlans.find(
    plan => resolveActivationStrategy(plan) === 'topup-first',
  )?.reference

  const periodEnd = usage?.periodEnd ?? null
  const period = resolvePeriodDisplay(periodEnd)
  const cap = remainingCap(planForActions)
  const meter = usage?.meterRef ?? null
  const planName = allowanceProduct?.planName ?? planForActions?.name ?? 'plan'
  const planLabel =
    planShape === 'free' || planShape === 'trial' ? planName.toLowerCase() : planName
  const unit = allowanceMeterUnit(meter, cap && cap > 0 ? cap : 2)
  const verb =
    accountState === 'F' ? copy.account.switchPlanButton : copy.account.activatePlanButton

  useEffect(() => {
    if (!pendingRef) return
    if (state === 'payment_required' || state === 'topup_required') {
      onChangePlan?.(pendingRef)
      setPendingRef(null)
      return
    }
    if (state === 'activated' || state === 'error') {
      setPendingRef(null)
    }
  }, [state, pendingRef, onChangePlan])

  const handlePlanAction = (plan: LadderPlan) => {
    if (needsPayment(plan, credits) || !productRef) {
      onChangePlan?.(plan.reference)
      return
    }
    setPendingRef(plan.reference)
    void activate({ productRef, planRef: plan.reference })
  }

  return (
    <div className="solvapay-mcp-account">
      <div className={cx.card}>
        <PlanIdentityHeader
          name={product?.name ?? allowanceProduct?.productName}
          description={product?.description}
          planLine={
            accountState === 'A'
              ? copy.account.choosePlanCaption
              : formatCapLine(allowanceProduct, planForActions, locale)
          }
          status={accountState === 'F' ? 'pill' : 'idle'}
          statusLabel={
            accountState === 'F'
              ? interpolate(copy.usage.limitReached, { plan: planName })
              : copy.account.noPlanStatus
          }
          changePlanLabel={copy.account.changePlanButton}
          showChangePlan={false}
        />

        {accountState === 'F' ? (
          <div className="solvapay-mcp-used-up">
            <h2 className="solvapay-mcp-used-up-title">
              {interpolate(copy.account.usedUpTitle, { plan: planLabel, unit })}
            </h2>
            <p>
              {period.kind === 'date'
                ? interpolate(copy.account.usedUpBody, {
                    date: formatShortDate(period.periodEnd, locale) ?? period.periodEnd,
                    days: String(daysUntil(period.periodEnd) ?? 0),
                  })
                : copy.account.usedUpBodyNoDate}
            </p>
            {credits > 0 && planShape !== 'usage-based' ? (
              <p className={cx.muted}>
                {interpolate(copy.account.antiTrapCredits, {
                  credits: new Intl.NumberFormat(locale).format(credits),
                  plan: planName,
                })}
              </p>
            ) : null}
          </div>
        ) : null}

        {ladderPlans.length > 0 ? (
          <Section>
            <Eyebrow variant="rail">
              {accountState === 'F' ? copy.account.carryOnEyebrow : copy.account.plansEyebrow}
            </Eyebrow>
            <div className="solvapay-mcp-plan-list solvapay-mcp-plan-action-list">
              {ladderPlans.map(plan => (
                <LadderPlanRow
                  key={plan.reference}
                  plan={plan}
                  locale={locale}
                  emphasized={plan.reference === emphasizedRef}
                  actionLabel={
                    pendingRef === plan.reference ? copy.account.activatingPlanButton : verb
                  }
                  busy={pendingRef === plan.reference}
                  disabled={pendingRef !== null && pendingRef !== plan.reference}
                  merchantName={merchant?.displayName}
                  onAction={() => handlePlanAction(plan)}
                />
              ))}
            </div>
            {accountState === 'A' ? (
              <p className={cx.muted}>{copy.account.plansStartCaption}</p>
            ) : null}
            {accountState === 'F' && period.kind === 'date' ? (
              <p className={cx.muted}>
                {interpolate(copy.account.waitUntilReset, {
                  date: formatShortDate(period.periodEnd, locale) ?? period.periodEnd,
                  plan: planLabel,
                })}
              </p>
            ) : null}
          </Section>
        ) : accountState === 'A' && onChangePlan ? (
          <div className={cx.stack}>
            <p className={cx.muted}>{copy.account.noPlanBody}</p>
            <button type="button" className={cx.button} onClick={() => onChangePlan()}>
              {copy.account.pickPlanButton}
            </button>
          </div>
        ) : null}

        {error ? (
          <p className={cx.error} role="alert">
            {error}
          </p>
        ) : null}

        {showPortalCta && !isFullscreen ? (
          <>
            <p className={cx.muted} data-solvapay-mcp-portal-hint="">
              {copy.currentPlan.portalHint}
            </p>
            <LaunchCustomerPortalButton
              className={cx.button}
              loadingClassName={cx.button}
              errorClassName={cx.button}
            />
          </>
        ) : null}
      </div>
      {isFullscreen ? <AccountIdentityFooter /> : null}
    </div>
  )
}

function needsPayment(plan: PlanLike, credits: number): boolean {
  const shape = resolvePlanShape(plan)
  if (shape === 'free' || shape === 'trial') return false
  if (shape === 'usage-based') return credits <= 0
  return true
}

function listLadderPlans(
  plans: readonly PlanLike[] | undefined,
  {
    excludeRef,
    excludeFree,
  }: {
    excludeRef?: string | null
    excludeFree: boolean
  },
): LadderPlan[] {
  if (!plans) return []
  return plans.filter((plan): plan is LadderPlan => {
    if (!plan.reference) return false
    if (excludeRef && plan.reference === excludeRef) return false
    if (excludeFree) {
      const shape = resolvePlanShape(plan)
      if (shape === 'free' || shape === 'trial') return false
    }
    return true
  })
}

function formatCapLine(
  product: ActiveProduct | undefined,
  plan: PlanLike | null,
  locale: string,
): string | null {
  const name = product?.planName ?? plan?.name
  if (!name) return null
  const cap = includedUnits(plan)
  const cycle = billingCycle(plan)
  if (cap == null || cap <= 0) return name
  const unit = allowanceMeterUnit(null, cap)
  const interval = cycle?.interval ?? 'month'
  return `${name} · ${new Intl.NumberFormat(locale).format(cap)} ${unit} per ${interval}`
}
