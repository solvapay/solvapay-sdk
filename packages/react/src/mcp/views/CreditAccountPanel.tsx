'use client'

/**
 * Credit-plan account states B (running) and D (spent).
 */

import React from 'react'
import { ExternalLinkGlyph } from '../../components/ExternalLinkGlyph'
import { LaunchCustomerPortalButton } from '../../components/LaunchCustomerPortalButton'
import { useBalance } from '../../hooks/useBalance'
import { useCopy } from '../../hooks/useCopy'
import { useExternalLinkClick } from '../../hooks/useExternalLink'
import { useHistory } from '../../hooks/useHistory'
import { useMerchant } from '../../hooks/useMerchant'
import { useDisplayMode } from '../hooks/useDisplayMode'
import type { BootstrapCustomer, BootstrapProduct } from '@solvapay/mcp-core'
import { resolveRateDisplay } from '../account-state'
import { formatProductTerms, type ActiveProduct } from '../derive-active-products'
import { resolvePlanActions, resolvePlanShape, type PlanLike } from '../plan-actions'
import { SplitRow } from '../primitives'
import { AccountIdentityFooter, CreditActivitySection } from './accountFullscreen'
import { BalanceStrip, PlanIdentityHeader } from './accountViewShared'
import { resolveMcpClassNames, type McpViewClassNames } from './types'

export function CreditAccountPanel({
  accountState,
  product,
  creditProduct,
  planForActions,
  plans,
  productRef,
  locale,
  classNames,
  onTopup,
  autoRecharge,
  autoRechargeUrl,
  onChangePlan,
  showPortalCta,
}: {
  accountState: 'B' | 'D'
  product?: Pick<BootstrapProduct, 'name' | 'description'> | null
  creditProduct?: ActiveProduct
  planForActions: PlanLike | null
  plans?: readonly PlanLike[]
  productRef?: string
  locale: string
  classNames?: McpViewClassNames
  onTopup?: () => void
  autoRecharge?: BootstrapCustomer['autoRecharge'] | null
  autoRechargeUrl?: string | null
  onChangePlan?: (planRef?: string) => void
  showPortalCta: boolean
}): React.ReactElement {
  const cx = resolveMcpClassNames(classNames)
  const copy = useCopy()
  const balance = useBalance()
  const { merchant } = useMerchant()
  const handleExternalClick = useExternalLinkClick()
  const { displayMode } = useDisplayMode()
  const isFullscreen = displayMode === 'fullscreen'
  const history = useHistory({
    productRef,
    enabled: isFullscreen,
  })
  const rate = resolveRateDisplay(planForActions, balance)
  const planLine = creditProduct
    ? formatProductTerms(creditProduct, locale, {
        rate: rate.showRunway ? rate.label : null,
      })
    : null
  const paidPlanCount = (plans ?? []).filter(plan => resolvePlanShape(plan) !== 'free').length
  const actions = resolvePlanActions({
    purchase: { planSnapshot: planForActions, hasPaymentMethod: false },
    planCount: plans?.length ?? 0,
    paidPlanCount,
  })
  const showChangePlan = Boolean(onChangePlan && (actions.changePlan || actions.upgrade))
  const status = autoRecharge?.status
  const enabled = autoRecharge?.enabled === true
  const failed = status === 'failed'
  const pendingSetup = enabled && status === 'pending_setup'
  const title = failed
    ? copy.autoRecharge.statusFailed
    : pendingSetup
      ? copy.account.autoRechargePending
      : enabled
        ? copy.account.autoRechargeOn
        : copy.account.autoRechargeOff
  const caption =
    !enabled && !failed
      ? accountState === 'D'
        ? copy.account.autoRechargeOffFixCaption
        : copy.account.autoRechargeOffCaption
      : null
  const actionLabel = failed
    ? copy.account.fixCard
    : enabled
      ? copy.account.manage
      : copy.account.turnOn

  return (
    <div className="solvapay-mcp-account">
      <div className={cx.card}>
        <PlanIdentityHeader
          name={product?.name ?? creditProduct?.productName}
          description={product?.description}
          planLine={planLine}
          failing={accountState === 'D'}
          failingLabel={copy.usage.callsFailing}
          changePlanLabel={copy.account.changePlanButton}
          showChangePlan={showChangePlan}
          onChangePlan={onChangePlan}
        />
        <BalanceStrip
          merchantName={merchant?.displayName}
          locale={locale}
          worksAcross={copy.account.worksAcross}
          creditBalanceLabel={copy.account.creditBalance}
          failingCaption={accountState === 'D' ? copy.account.callsFailingCaption : null}
        />
        {onTopup ? (
          <button type="button" className={cx.button} onClick={onTopup}>
            {copy.account.addFunds}
          </button>
        ) : null}
        <SplitRow>
          <div className="solvapay-mcp-auto-recharge-copy">
            <p>{title}</p>
            {caption ? <p className={cx.muted}>{caption}</p> : null}
          </div>
          {autoRechargeUrl ? (
            <a
              href={autoRechargeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={cx.linkButton}
              aria-label={`${actionLabel} (opens in a new tab)`}
              onClick={handleExternalClick}
            >
              {actionLabel}
              <ExternalLinkGlyph />
            </a>
          ) : null}
        </SplitRow>
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
        <CreditActivitySection
          entries={history.creditActivity?.entries ?? null}
          loading={history.loading}
          error={history.error}
        />
      ) : null}
      {isFullscreen ? <AccountIdentityFooter /> : null}
    </div>
  )
}
