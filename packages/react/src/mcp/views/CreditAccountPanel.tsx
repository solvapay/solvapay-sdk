'use client'

/**
 * Credit-plan account states B (running) and D (spent).
 */

import React from 'react'
import { LaunchCustomerPortalButton } from '../../components/LaunchCustomerPortalButton'
import { useAutoRecharge } from '../../hooks/useAutoRecharge'
import { useBalance } from '../../hooks/useBalance'
import { useCopy } from '../../hooks/useCopy'
import { useHistory } from '../../hooks/useHistory'
import { useMerchant } from '../../hooks/useMerchant'
import { usePaymentMethod } from '../../hooks/usePaymentMethod'
import { useDisplayMode } from '../hooks/useDisplayMode'
import type { BootstrapProduct } from '@solvapay/mcp-core'
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
  onAutoRecharge,
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
  onAutoRecharge?: () => void
  onChangePlan?: (planRef?: string) => void
  showPortalCta: boolean
}): React.ReactElement {
  const cx = resolveMcpClassNames(classNames)
  const copy = useCopy()
  const balance = useBalance()
  const { merchant } = useMerchant()
  const { config: autoRecharge } = useAutoRecharge()
  const { paymentMethod } = usePaymentMethod()
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
  const autoRechargeOn = Boolean(autoRecharge?.enabled)
  const hasReusableCard = paymentMethod?.kind === 'card' && paymentMethod.reusable
  const autoRechargeAction =
    onAutoRecharge && (autoRechargeOn || hasReusableCard) ? onAutoRecharge : undefined
  const autoRechargeActionLabel = autoRechargeOn ? copy.account.manage : copy.account.turnOn

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
            <p>{autoRechargeOn ? copy.account.autoRechargeOn : copy.account.autoRechargeOff}</p>
            {!autoRechargeOn ? (
              <p className={cx.muted}>
                {accountState === 'D'
                  ? copy.account.autoRechargeOffFixCaption
                  : copy.account.autoRechargeOffCaption}
              </p>
            ) : null}
          </div>
          {autoRechargeAction ? (
            <button type="button" className={cx.linkButton} onClick={autoRechargeAction}>
              {autoRechargeActionLabel}
            </button>
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
