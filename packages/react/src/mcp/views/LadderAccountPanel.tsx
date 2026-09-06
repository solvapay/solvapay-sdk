'use client'

/**
 * Account states A (no plan) and F (allowance at cap).
 *
 * One family: a `PlanRow` ladder. A is the whole widget. F suppresses
 * the balance box, drops Change plan, and states the credit trap when
 * credits cannot restore calls. PAYG is emphasized when its activation
 * strategy is `topup-first`.
 */

import React from 'react'
import { billingCycle, headlineCharges, includedUnits } from '@solvapay/core'
import type { BootstrapProduct } from '@solvapay/mcp-core'
import { LaunchCustomerPortalButton } from '../../components/LaunchCustomerPortalButton'
import { useActivation } from '../../hooks/useActivation'
import { useBalance } from '../../hooks/useBalance'
import { useCopy } from '../../hooks/useCopy'
import { useUsage } from '../../hooks/useUsage'
import { interpolate } from '../../i18n/interpolate'
import {
  allowanceMeterUnit,
  daysUntil,
  remainingCap,
  resolvePeriodDisplay,
} from '../account-state'
import { formatShortDate, type ActiveProduct } from '../derive-active-products'
import {
  resolveActivationStrategy,
  resolvePlanShape,
  type PlanLike,
  type PlanShape,
} from '../plan-actions'
import { Eyebrow, Section } from '../primitives'
import { PlanIdentityHeader } from './accountViewShared'
import { CheckoutPlanRow, type LadderPlan } from './checkout/CheckoutPlanRow'
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
  onChangePlan?: () => void
  showPortalCta: boolean
}): React.ReactElement {
  const cx = resolveMcpClassNames(classNames)
  const copy = useCopy()
  const balance = useBalance()
  const { usage } = useUsage()
  const { activate, error } = useActivation()
  const credits = balance.credits ?? 0

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

  const handlePlanClick = (plan: LadderPlan) => {
    const strategy = resolveActivationStrategy(plan)
    if (strategy === 'activate' && productRef) {
      void activate({ productRef, planRef: plan.reference })
      return
    }
    onChangePlan?.()
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
            <div className="solvapay-mcp-plan-list">
              {ladderPlans.map(plan => (
                <CheckoutPlanRow
                  key={plan.reference}
                  plan={plan}
                  locale={locale}
                  selected={plan.reference === emphasizedRef}
                  current={false}
                  free={false}
                  disabled={false}
                  selectedOption={optionFromPlan(plan)}
                  balance={balance}
                  onSelect={() => handlePlanClick(plan)}
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
            <button type="button" className={cx.button} onClick={onChangePlan}>
              {copy.account.pickPlanButton}
            </button>
          </div>
        ) : null}

        {error ? (
          <p className={cx.error} role="alert">
            {error}
          </p>
        ) : null}

        {showPortalCta ? (
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
    </div>
  )
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

function optionFromPlan(plan: PlanLike): { price: number; currency: string } {
  const headline = headlineCharges(plan)[0]
  return {
    price: headline?.amountMinor ?? plan.price ?? 0,
    currency: headline?.currency ?? plan.currency ?? 'usd',
  }
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
