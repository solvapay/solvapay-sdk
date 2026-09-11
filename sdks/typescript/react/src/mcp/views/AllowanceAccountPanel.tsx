'use client'

/**
 * Allowance-plan account states C (paid / unlimited) and E (free / trial).
 *
 * One component: Remaining-led FactBand + meter. Price drops out of the
 * plan line for free/trial. E upgrade is a link. Credits always stay.
 */

import React from 'react'
import { billingCycle } from '@solvapay/core'
import { formatPlanPriceLabel } from '../../primitives/checkout/shared'
import type { BootstrapProduct } from '@solvapay/mcp-core'
import { LaunchCustomerPortalButton } from '../../components/LaunchCustomerPortalButton'
import { useCopy } from '../../hooks/useCopy'
import { useHistory } from '../../hooks/useHistory'
import { useLimits } from '../../hooks/useLimits'
import { useUsage } from '../../hooks/useUsage'
import { useDisplayMode } from '../hooks/useDisplayMode'
import { interpolate } from '../../i18n/interpolate'
import { UsageMeter } from '../../primitives/UsageMeter'
import {
  allowanceMeterUnit,
  daysUntil,
  remainingCap,
  resolveOneTimeDisplay,
  resolvePeriodDisplay,
  resolveRemaining,
} from '../account-state'
import {
  formatAllowanceTerms,
  formatShortDate,
  formatSince,
  type ActiveProduct,
} from '../derive-active-products'
import {
  resolvePlanActions,
  resolvePlanShape,
  type PlanLike,
  type PlanShape,
} from '../plan-actions'
import { FactBand, SplitRow, type FactBandItem } from '../primitives'
import { McpUsageMeter } from '../primitives/UsageMeter'
import { AccountIdentityFooter, ChargesSection } from './accountFullscreen'
import { PlanIdentityHeader } from './accountViewShared'
import { resolveMcpClassNames, type McpViewClassNames } from './types'

export function AllowanceAccountPanel({
  accountState,
  product,
  allowanceProduct,
  planForActions,
  planShape,
  productRef,
  plans,
  locale,
  classNames,
  onChangePlan,
  showPortalCta,
}: {
  accountState: 'C' | 'E'
  product?: Pick<BootstrapProduct, 'name' | 'description'> | null
  allowanceProduct?: ActiveProduct
  planForActions: PlanLike | null
  planShape: PlanShape | null
  productRef?: string
  plans?: readonly PlanLike[]
  locale: string
  classNames?: McpViewClassNames
  onChangePlan?: (planRef?: string) => void
  showPortalCta: boolean
}): React.ReactElement {
  const cx = resolveMcpClassNames(classNames)
  const copy = useCopy()
  const { displayMode } = useDisplayMode()
  const isFullscreen = displayMode === 'fullscreen' && accountState === 'C'
  const limits = useLimits({ productRef, enabled: Boolean(productRef) })
  const { usage } = useUsage()
  const history = useHistory({
    productRef,
    enabled: isFullscreen,
  })
  const oneTime = resolveOneTimeDisplay(planForActions)
  const periodEnd = usage?.periodEnd ?? null
  const period = resolvePeriodDisplay(periodEnd)
  const dropPrice = planShape === 'free' || planShape === 'trial'
  const planLine = allowanceProduct
    ? formatAllowanceTerms(allowanceProduct, locale, {
        price: dropPrice
          ? null
          : planForActions
            ? formatPlanPriceLabel(planForActions, locale)
            : null,
        renewsOn: !dropPrice && period.kind === 'date' ? period.periodEnd : null,
        started: dropPrice,
        qualifier: oneTime.planQualifier,
      })
    : null

  const paidPlanCount = (plans ?? []).filter(plan => resolvePlanShape(plan) !== 'free').length
  const actions = resolvePlanActions({
    purchase: { planSnapshot: planForActions, hasPaymentMethod: false },
    planCount: plans?.length ?? 0,
    paidPlanCount,
  })
  const showChangePlan = Boolean(onChangePlan && (actions.changePlan || actions.upgrade))
  const showSeePlans = Boolean(accountState === 'E' && onChangePlan && actions.upgrade)

  const cap = remainingCap(planForActions)
  const remaining = resolveRemaining({
    remaining: limits.remaining,
    cap,
    limitsResolved: limits.remaining !== null || cap === 0,
  })
  const meter = usage?.meterRef ?? limits.meterName
  const total = remaining.kind === 'finite' ? (usage?.total ?? cap) : null
  const facts = buildAllowanceFacts({
    remaining,
    total,
    period,
    showPeriod: oneTime.showRenews || dropPrice,
    periodKind: dropPrice ? 'resets' : 'renews',
    meter,
    locale,
    copy,
    fullscreenCredits: isFullscreen,
  })

  const showMeter = remaining.kind === 'finite' && usage != null && total != null && total > 0
  const used =
    remaining.kind === 'finite' && total != null
      ? usage?.total != null
        ? usage.used
        : Math.max(0, total - remaining.remaining)
      : (usage?.used ?? 0)
  const percent =
    usage?.percentUsed ??
    (total != null && total > 0 ? Math.min(100, Math.round((used / total) * 10000) / 100) : null)
  const meterCaption = showMeter
    ? buildMeterCaption({
        used,
        total,
        remaining: remaining.remaining,
        percent,
        meter,
        locale,
        copy,
      })
    : null

  return (
    <div className="solvapay-mcp-account">
      <div className={cx.card}>
        <PlanIdentityHeader
          name={product?.name ?? allowanceProduct?.productName}
          description={product?.description}
          planLine={planLine}
          changePlanLabel={copy.account.changePlanButton}
          showChangePlan={showChangePlan}
          onChangePlan={onChangePlan}
        />
        <div className="solvapay-mcp-allowance-body">
          <FactBand items={facts} />
          {showMeter ? (
            <McpUsageMeter
              usageOverride={
                usage != null && total != null
                  ? { ...usage, total, used, percentUsed: percent }
                  : usage
              }
            >
              <UsageMeter.Bar />
              {meterCaption ? (
                <p className="solvapay-mcp-usage-meter-caption">{meterCaption}</p>
              ) : null}
            </McpUsageMeter>
          ) : null}
        </div>
        {showSeePlans && onChangePlan ? (
          <SplitRow>
            <div className="solvapay-mcp-auto-recharge-copy">
              <p>
                {interpolate(copy.account.needMoreAllowance, {
                  total: new Intl.NumberFormat(locale).format(total ?? cap ?? 0),
                  unit: allowanceMeterUnit(meter, total ?? cap ?? 0),
                  interval: billingCycle(planForActions)?.interval ?? 'month',
                })}
              </p>
              <p className={cx.muted}>{copy.account.upgradePaygCaption}</p>
            </div>
            <button type="button" className={cx.linkButton} onClick={() => onChangePlan()}>
              {copy.account.seePlans}
            </button>
          </SplitRow>
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
      {isFullscreen && productRef ? (
        <ChargesSection charges={history.charges} loading={history.loading} error={history.error} />
      ) : null}
      {isFullscreen ? <AccountIdentityFooter /> : null}
    </div>
  )
}

function formatCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value)
}

function buildAllowanceFacts({
  remaining,
  total,
  period,
  showPeriod,
  periodKind,
  meter,
  locale,
  copy,
  fullscreenCredits,
}: {
  remaining: ReturnType<typeof resolveRemaining>
  total: number | null
  period: ReturnType<typeof resolvePeriodDisplay>
  showPeriod: boolean
  periodKind: 'renews' | 'resets'
  meter: string | null
  locale: string
  copy: ReturnType<typeof useCopy>
  fullscreenCredits: boolean
}): FactBandItem[] {
  const items: FactBandItem[] = []

  if (remaining.kind === 'finite') {
    const unit = allowanceMeterUnit(meter, remaining.remaining)
    const ofUnit = allowanceMeterUnit(meter, total ?? remaining.remaining)
    items.push({
      key: 'remaining',
      label: copy.usage.remainingEyebrow,
      value: interpolate(copy.usage.remainingCalls, {
        remaining: formatCount(remaining.remaining, locale),
        unit,
      }),
      compactValue:
        total != null
          ? interpolate(copy.usage.remainingOfTotal, {
              remaining: formatCount(remaining.remaining, locale),
              total: formatCount(total, locale),
              unit: ofUnit,
            })
          : undefined,
      caption:
        total != null
          ? interpolate(copy.usage.ofTotalThisPeriod, { total: formatCount(total, locale) })
          : undefined,
    })
  } else {
    items.push({
      key: 'remaining',
      label: copy.usage.remainingEyebrow,
      value: (
        <span data-unknown={remaining.kind === 'unknown' ? '' : undefined}>
          {remaining.kind === 'unlimited' ? copy.usage.unlimitedLabel : copy.usage.notKnownYet}
        </span>
      ),
    })
  }

  if (showPeriod) {
    const label = periodKind === 'resets' ? copy.usage.resetsEyebrow : copy.usage.renewsEyebrow
    if (period.kind === 'none') {
      items.push({
        key: 'period',
        label,
        value: copy.usage.afterFirstCall,
      })
    } else {
      const date = formatSince(period.periodEnd, locale)
      const days = daysUntil(period.periodEnd)
      const inDays =
        days != null && days > 0 ? interpolate(copy.usage.inDays, { days: String(days) }) : null
      const shortDate = formatShortDate(period.periodEnd, locale)
      items.push({
        key: 'period',
        label,
        value: date ?? copy.usage.afterFirstCall,
        compactValue:
          shortDate && days != null && days > 0
            ? `${shortDate}, in ${days} days`
            : (date ?? undefined),
        caption: inDays ?? undefined,
      })
    }
  }

  items.push({
    key: 'credits',
    label: copy.usage.creditsEyebrow,
    value: copy.usage.creditsNotUsed,
    compactValue: copy.usage.creditsNotUsed,
    caption: fullscreenCredits ? copy.usage.creditsDoNotSpend : copy.usage.creditsUntouched,
  })

  return items
}

function buildMeterCaption({
  used,
  total,
  remaining,
  percent,
  meter,
  locale,
  copy,
}: {
  used: number
  total: number
  remaining: number
  percent: number | null
  meter: string | null
  locale: string
  copy: ReturnType<typeof useCopy>
}): string {
  const usedLine = interpolate(copy.usage.usedOfTotalPercent, {
    used: formatCount(used, locale),
    total: formatCount(total, locale),
    unit: allowanceMeterUnit(meter, used),
    percent: String(Math.round(percent ?? (total > 0 ? (used / total) * 100 : 0))),
  })
  const hint =
    remaining === 1
      ? interpolate(copy.usage.lastCallHint, { unit: allowanceMeterUnit(meter, 1) })
      : copy.usage.warningThresholdHint
  return `${usedLine} ${hint}`
}
