'use client'

/**
 * Account states the data forces: G (skeleton), H (claim free), I
 * (overage without money), J (cancelled, not expired).
 *
 * One family so `<McpAccountView>` stays a router. I ships used-of-
 * allowance + still-working + a 100% meter — no client-side
 * `units × rate`. J restyles `CancelledPlanNotice`; Reactivate is
 * secondary.
 */

import React from 'react'
import { billingCycle, includedUnits } from '@solvapay/core'
import { formatPlanPriceLabel } from '../../primitives/checkout/shared'
import type { BootstrapProduct } from '@solvapay/mcp-core'
import { LaunchCustomerPortalButton } from '../../components/LaunchCustomerPortalButton'
import { useActivation } from '../../hooks/useActivation'
import { useCopy } from '../../hooks/useCopy'
import { useLimits } from '../../hooks/useLimits'
import { usePurchase } from '../../hooks/usePurchase'
import { useUsage } from '../../hooks/useUsage'
import { interpolate } from '../../i18n/interpolate'
import { CancelledPlanNotice } from '../../primitives/CancelledPlanNotice'
import { UsageMeter } from '../../primitives/UsageMeter'
import { allowanceMeterUnit, daysUntil, remainingCap } from '../account-state'
import { formatShortDate, formatSince, type ActiveProduct } from '../derive-active-products'
import { resolvePlanShape, type PlanLike } from '../plan-actions'
import { LineItem } from '../primitives'
import { McpUsageMeter } from '../primitives/UsageMeter'
import { PlanIdentityHeader } from './accountViewShared'
import { resolveMcpClassNames, type McpViewClassNames } from './types'

export function ForcedAccountPanel({
  accountState,
  product,
  allowanceProduct,
  planForActions,
  plans,
  productRef,
  locale,
  classNames,
  onChangePlan,
  showPortalCta,
}: {
  accountState: 'G' | 'H' | 'I' | 'J'
  product?: Pick<BootstrapProduct, 'name' | 'description'> | null
  allowanceProduct?: ActiveProduct
  planForActions: PlanLike | null
  plans?: readonly PlanLike[]
  productRef?: string
  locale: string
  classNames?: McpViewClassNames
  onChangePlan?: (planRef?: string) => void
  showPortalCta: boolean
}): React.ReactElement {
  const cx = resolveMcpClassNames(classNames)

  if (accountState === 'G') {
    return (
      <div className="solvapay-mcp-account">
        <div className={cx.card} data-solvapay-mcp-account-skeleton="" aria-busy="true">
          <AccountSkeleton />
        </div>
      </div>
    )
  }

  if (accountState === 'H') {
    return (
      <ActivateAccountPanel
        product={product}
        plans={plans}
        productRef={productRef}
        locale={locale}
        classNames={classNames}
        showPortalCta={showPortalCta}
      />
    )
  }

  if (accountState === 'I') {
    return (
      <OverageAccountPanel
        product={product}
        allowanceProduct={allowanceProduct}
        planForActions={planForActions}
        locale={locale}
        classNames={classNames}
        onChangePlan={onChangePlan}
        showPortalCta={showPortalCta}
      />
    )
  }

  return (
    <CancelledAccountPanel
      product={product}
      allowanceProduct={allowanceProduct}
      planForActions={planForActions}
      productRef={productRef}
      locale={locale}
      classNames={classNames}
      showPortalCta={showPortalCta}
    />
  )
}

function AccountSkeleton(): React.ReactElement {
  return (
    <div className="solvapay-mcp-skeleton">
      <div className="solvapay-mcp-skeleton-identity">
        <div className="solvapay-mcp-skeleton-row">
          <span className="solvapay-mcp-skeleton-line solvapay-mcp-skeleton-name" />
          <span className="solvapay-mcp-skeleton-line solvapay-mcp-skeleton-status" />
        </div>
        <span className="solvapay-mcp-skeleton-line solvapay-mcp-skeleton-desc" />
        <span className="solvapay-mcp-skeleton-line solvapay-mcp-skeleton-desc-short" />
      </div>
      <div className="solvapay-mcp-skeleton-facts">
        <div className="solvapay-mcp-skeleton-row">
          <span className="solvapay-mcp-skeleton-line solvapay-mcp-skeleton-label" />
          <span className="solvapay-mcp-skeleton-line solvapay-mcp-skeleton-value" />
        </div>
        <span className="solvapay-mcp-skeleton-line solvapay-mcp-skeleton-meter" />
        <div className="solvapay-mcp-skeleton-row">
          <span className="solvapay-mcp-skeleton-line solvapay-mcp-skeleton-label-sm" />
          <span className="solvapay-mcp-skeleton-line solvapay-mcp-skeleton-value-sm" />
        </div>
      </div>
      <span className="solvapay-mcp-skeleton-line solvapay-mcp-skeleton-cta" />
    </div>
  )
}

function ActivateAccountPanel({
  product,
  plans,
  productRef,
  locale,
  classNames,
  showPortalCta,
}: {
  product?: Pick<BootstrapProduct, 'name' | 'description'> | null
  plans?: readonly PlanLike[]
  productRef?: string
  locale: string
  classNames?: McpViewClassNames
  showPortalCta: boolean
}): React.ReactElement {
  const cx = resolveMcpClassNames(classNames)
  const copy = useCopy()
  const { activate, state, error } = useActivation()
  const freePlan = findActivatablePlan(plans)
  if (!productRef) {
    throw new Error('McpAccountView: state H requires productRef')
  }
  const cap = includedUnits(freePlan)
  if (cap == null || cap <= 0) {
    throw new Error('McpAccountView: state H free plan has no included cap')
  }
  const cycle = billingCycle(freePlan)
  const unit = allowanceMeterUnit(null, cap)

  return (
    <div className="solvapay-mcp-account">
      <div className={cx.card}>
        <PlanIdentityHeader
          name={product?.name}
          description={product?.description}
          planLine={null}
          status="idle"
          statusLabel={copy.account.notStartedStatus}
          changePlanLabel={copy.account.changePlanButton}
          showChangePlan={false}
        />
        <div className="solvapay-mcp-claim-body">
          <h2 className="solvapay-mcp-claim-title">
            {interpolate(copy.account.readyToClaim, {
              total: formatCount(cap, locale),
              unit,
              interval: cycle?.interval ?? 'month',
            })}
          </h2>
          <p className={cx.muted}>{copy.account.noCardCaption}</p>
        </div>
        <button
          type="button"
          className={cx.button}
          disabled={state === 'activating'}
          onClick={() => {
            void activate({ productRef, planRef: freePlan.reference })
          }}
        >
          {copy.account.startFreePlan}
        </button>
        {error ? (
          <p className={cx.error} role="alert">
            {error}
          </p>
        ) : null}
        {showPortalCta ? <PortalHint classNames={classNames} /> : null}
      </div>
    </div>
  )
}

function OverageAccountPanel({
  product,
  allowanceProduct,
  planForActions,
  locale,
  classNames,
  onChangePlan,
  showPortalCta,
}: {
  product?: Pick<BootstrapProduct, 'name' | 'description'> | null
  allowanceProduct?: ActiveProduct
  planForActions: PlanLike | null
  locale: string
  classNames?: McpViewClassNames
  onChangePlan?: (planRef?: string) => void
  showPortalCta: boolean
}): React.ReactElement {
  const cx = resolveMcpClassNames(classNames)
  const copy = useCopy()
  const { usage } = useUsage()
  const cap = remainingCap(planForActions)
  if (cap == null || cap <= 0) {
    throw new Error('McpAccountView: state I requires a finite allowance cap')
  }
  const used = usage?.used ?? 0
  const meter = usage?.meterRef ?? null
  const unit = allowanceMeterUnit(meter, cap)
  const price = planForActions ? formatPlanPriceLabel(planForActions, locale) : null
  const planName = allowanceProduct?.planName ?? planForActions?.name
  const planLine = [planName, price].filter(Boolean).join(' · ') || null

  return (
    <div className="solvapay-mcp-account">
      <div className={cx.card}>
        <PlanIdentityHeader
          name={product?.name ?? allowanceProduct?.productName}
          description={product?.description}
          planLine={planLine}
          status="pill"
          statusLabel={copy.usage.overAllowance}
          pillState="I"
          changePlanLabel={copy.account.changePlanButton}
          showChangePlan={false}
        />
        <div className="solvapay-mcp-overage-meter">
          <LineItem
            label={copy.usage.usedEyebrow}
            value={interpolate(copy.account.usedOfAllowance, {
              used: formatCount(used, locale),
              total: formatCount(cap, locale),
              unit,
            })}
          />
          <McpUsageMeter
            usageOverride={{
              meterRef: meter,
              used,
              total: cap,
              remaining: 0,
              percentUsed: 100,
              ...(usage?.periodEnd ? { periodEnd: usage.periodEnd } : {}),
            }}
          >
            <UsageMeter.Bar />
          </McpUsageMeter>
        </div>
        <p className="solvapay-mcp-overage-copy">{copy.account.stillWorking}</p>
        {onChangePlan ? (
          <button type="button" className={cx.linkButton} onClick={() => onChangePlan()}>
            {copy.account.seeHigherLimit}
          </button>
        ) : null}
        {showPortalCta ? <PortalHint classNames={classNames} /> : null}
      </div>
    </div>
  )
}

function CancelledAccountPanel({
  product,
  allowanceProduct,
  planForActions,
  productRef,
  locale,
  classNames,
  showPortalCta,
}: {
  product?: Pick<BootstrapProduct, 'name' | 'description'> | null
  allowanceProduct?: ActiveProduct
  planForActions: PlanLike | null
  productRef?: string
  locale: string
  classNames?: McpViewClassNames
  showPortalCta: boolean
}): React.ReactElement {
  const cx = resolveMcpClassNames(classNames)
  const copy = useCopy()
  const limits = useLimits({ productRef, enabled: Boolean(productRef) })
  const { usage } = useUsage()
  const { activePurchase } = usePurchase()
  const planName = allowanceProduct?.planName ?? planForActions?.name ?? 'plan'
  const cancelledAt = activePurchase?.cancelledAt ?? null
  const endDate = activePurchase?.endDate ?? null
  const cancelledDate = cancelledAt ? formatSince(cancelledAt, locale) : null
  const untilDate = endDate ? formatShortDate(endDate, locale) : null
  const days = endDate ? daysUntil(endDate) : null
  const cap = remainingCap(planForActions)
  const remaining =
    limits.remaining !== null && limits.remaining !== undefined && limits.remaining >= 0
      ? limits.remaining
      : null
  const total =
    remaining != null
      ? (usage?.total ?? (cap && cap > 0 ? cap : null))
      : cap && cap > 0
        ? cap
        : null
  const meter = usage?.meterRef ?? limits.meterName
  const showMeter = remaining != null && total != null && total > 0
  const used =
    remaining != null && total != null
      ? usage?.total != null
        ? usage.used
        : Math.max(0, total - remaining)
      : (usage?.used ?? 0)
  const percent =
    usage?.percentUsed ??
    (total != null && total > 0 ? Math.min(100, Math.round((used / total) * 10000) / 100) : null)

  return (
    <div className="solvapay-mcp-account">
      <div className={cx.card}>
        <PlanIdentityHeader
          name={product?.name ?? allowanceProduct?.productName}
          description={product?.description}
          planLine={
            cancelledDate
              ? interpolate(copy.account.cancelledPlanLine, {
                  plan: planName,
                  date: cancelledDate,
                })
              : planName
          }
          status="active"
          statusLabel={
            untilDate ? interpolate(copy.account.activeUntil, { date: untilDate }) : undefined
          }
          changePlanLabel={copy.account.changePlanButton}
          showChangePlan={false}
        />
        <div className="solvapay-mcp-cancelled-body">
          {days != null ? (
            <h2 className="solvapay-mcp-cancelled-title">
              {interpolate(copy.account.daysLeftTitle, { days: String(days) })}
            </h2>
          ) : null}
          {untilDate ? (
            <p className={cx.muted}>
              {interpolate(copy.account.cancelledBody, { date: untilDate })}
            </p>
          ) : null}
        </div>
        {showMeter && remaining != null && total != null ? (
          <div className="solvapay-mcp-overage-meter">
            <LineItem
              label={copy.usage.remainingEyebrow}
              value={interpolate(copy.usage.remainingOfTotal, {
                remaining: formatCount(remaining, locale),
                total: formatCount(total, locale),
                unit: allowanceMeterUnit(meter, total),
              })}
            />
            <McpUsageMeter
              usageOverride={
                usage != null && total != null
                  ? { ...usage, total, used, percentUsed: percent }
                  : usage
              }
            >
              <UsageMeter.Bar />
            </McpUsageMeter>
          </div>
        ) : null}
        <CancelledPlanNotice.Root>
          <CancelledPlanNotice.ReactivateButton className={cx.button} data-variant="secondary">
            {interpolate(copy.account.reactivatePlan, { plan: planName })}
          </CancelledPlanNotice.ReactivateButton>
        </CancelledPlanNotice.Root>
        {showPortalCta ? <PortalHint classNames={classNames} /> : null}
      </div>
    </div>
  )
}

function PortalHint({ classNames }: { classNames?: McpViewClassNames }): React.ReactElement {
  const cx = resolveMcpClassNames(classNames)
  const copy = useCopy()
  return (
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
  )
}

function findActivatablePlan(plans: readonly PlanLike[] | undefined): PlanLike & {
  reference: string
} {
  if (!plans || plans.length === 0) {
    throw new Error('McpAccountView: state H requires catalog plans')
  }
  const free = plans.filter(plan => {
    const shape = resolvePlanShape(plan)
    return shape === 'free' || shape === 'trial'
  })
  const chosen = free.find(plan => Boolean(plan.reference))
  if (!chosen?.reference) {
    throw new Error('McpAccountView: state H requires a free catalog plan to activate')
  }
  return { ...chosen, reference: chosen.reference }
}

function formatCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value)
}
