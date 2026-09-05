'use client'

/**
 * `<McpAccountView>` — manage-account surface for the `account` viewer.
 *
 * v2 shape: the balance strip leads, auto-recharge sits beside it, and
 * Active products rows name the product + plan + since. Inline stays a
 * summary (at most three rows, two actions). Fullscreen can add per-row
 * Change plan and the customer-portal CTA. The old PLAN / SINCE /
 * AUTO-RECHARGE three-up is gone.
 */

import React from 'react'
import { creditsToDisplayMinorUnits, minorUnitsPerMajor } from '@solvapay/core'
import { LaunchCustomerPortalButton } from '../../components/LaunchCustomerPortalButton'
import { useAutoRecharge } from '../../hooks/useAutoRecharge'
import { useBalance } from '../../hooks/useBalance'
import { useCopy, useLocale } from '../../hooks/useCopy'
import { useMerchant } from '../../hooks/useMerchant'
import { usePurchase } from '../../hooks/usePurchase'
import { interpolate } from '../../i18n/interpolate'
import { CancelledPlanNotice } from '../../primitives/CancelledPlanNotice'
import type { BootstrapProduct } from '@solvapay/mcp-core'
import {
  deriveActiveProducts,
  formatProductTerms,
  type ActiveProduct,
} from '../derive-active-products'
import { useDisplayMode } from '../hooks/useDisplayMode'
import {
  findCatalogPlan,
  mergePlanSnapshot,
  resolvePlanActions,
  resolvePlanShape,
  type PlanLike,
} from '../plan-actions'
import { Eyebrow, Section, SplitRow, StatusDot } from '../primitives'
import { resolveMcpClassNames, type McpViewClassNames } from './types'

const INLINE_PRODUCT_CAP = 3

export interface McpAccountViewProps {
  /**
   * @deprecated Product context is not rendered in the account surface.
   * Kept for integrators who pass `bootstrap.product` through custom views.
   */
  product?: Pick<BootstrapProduct, 'name' | 'description'> | null
  classNames?: McpViewClassNames
  /**
   * Called when the user clicks "Add funds". `<McpAppShell>` wires this
   * to a surface swap so nothing re-mounts.
   */
  onTopup?: () => void
  /**
   * Called when the user clicks "Pick a plan" or a per-row Change plan
   * (fullscreen only). Wired by the shell to switch to checkout.
   */
  onChangePlan?: () => void
  /**
   * Product catalog used to decide Upgrade vs Change plan. The shell
   * passes `bootstrap.plans`.
   */
  plans?: readonly PlanLike[]
}

export function McpAccountView({
  classNames,
  onTopup,
  onChangePlan,
  plans,
}: McpAccountViewProps) {
  const cx = resolveMcpClassNames(classNames)
  const copy = useCopy()
  const locale = useLocale() ?? 'en'
  const { displayMode } = useDisplayMode()
  const isFullscreen = displayMode === 'fullscreen'
  const { loading, hasPaidPurchase, activePurchase, purchases } = usePurchase()
  const { credits } = useBalance()
  const { merchant } = useMerchant()
  const { config: autoRecharge } = useAutoRecharge()

  if (loading) {
    return (
      <div className={cx.card}>
        <p>Loading account…</p>
      </div>
    )
  }

  const products = deriveActiveProducts(purchases)
  const visibleProducts = isFullscreen ? products : products.slice(0, INLINE_PRODUCT_CAP)
  const hasCredits = (credits ?? 0) > 0
  const showPortalCta = Boolean(
    isFullscreen &&
      hasPaidPurchase &&
      activePurchase &&
      activePurchase.amount &&
      activePurchase.amount > 0,
  )
  const autoRechargeOn = Boolean(autoRecharge?.enabled)
  const showPickPlan = Boolean(onChangePlan && products.length === 0)

  return (
    <div className="solvapay-mcp-account">
      <div className={cx.card}>
        <BalanceStrip
          merchantName={merchant?.displayName}
          locale={locale}
          worksAcross={copy.account.worksAcross}
          creditBalanceLabel={copy.account.creditBalance}
        />

        <SplitRow>
          <p className={cx.muted}>
            {autoRechargeOn ? copy.account.autoRechargeOn : copy.account.autoRechargeOff}
          </p>
          {onTopup ? (
            <button type="button" className={cx.button} onClick={onTopup}>
              {copy.account.addFunds}
            </button>
          ) : null}
        </SplitRow>

        <CancelledPlanNotice.Root className={cx.notice}>
          <CancelledPlanNotice.Heading />
          <CancelledPlanNotice.Expires />
          <CancelledPlanNotice.DaysRemaining className={cx.muted} />
          <CancelledPlanNotice.ReactivateButton className={cx.button} />
        </CancelledPlanNotice.Root>

        {visibleProducts.length > 0 ? (
          <Section>
            <Eyebrow variant="rail">{copy.account.activeProducts}</Eyebrow>
            {visibleProducts.map(product => {
              const action = rowPlanAction(product, plans, copy)
              return (
                <ProductRow
                  key={product.reference}
                  product={product}
                  locale={locale}
                  showChangePlan={isFullscreen && Boolean(onChangePlan) && action.show}
                  changePlanLabel={action.label}
                  onChangePlan={onChangePlan}
                />
              )
            })}
          </Section>
        ) : null}

        {products.length === 0 && !hasCredits ? (
          <div className={cx.stack}>
            <h2 className={cx.heading}>{copy.account.noPlanTitle}</h2>
            <p className={cx.muted}>{copy.account.noPlanBody}</p>
            {showPickPlan ? (
              <button type="button" className={cx.button} onClick={onChangePlan}>
                {copy.account.pickPlanButton}
              </button>
            ) : null}
          </div>
        ) : null}

        {showPickPlan && hasCredits ? (
          <button type="button" className={cx.linkButton} onClick={onChangePlan}>
            {copy.account.seePlansButton}
          </button>
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

function BalanceStrip({
  merchantName,
  locale,
  worksAcross,
  creditBalanceLabel,
}: {
  merchantName?: string
  locale: string
  worksAcross: string
  creditBalanceLabel: string
}) {
  const { credits, displayCurrency, creditsPerMinorUnit, displayExchangeRate } = useBalance()
  const formattedCredits = new Intl.NumberFormat(locale).format(credits ?? 0)
  const fiat = formatFiatEquivalent({
    credits: credits ?? 0,
    displayCurrency,
    creditsPerMinorUnit,
    displayExchangeRate,
    locale,
  })
  const caption = [fiat ? `About ${fiat}.` : null, merchantName ? interpolate(worksAcross, { merchant: merchantName }) : null]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="solvapay-mcp-balance-strip">
      <Eyebrow variant="rail">{creditBalanceLabel}</Eyebrow>
      <p className="solvapay-mcp-balance-hero">
        {formattedCredits}
        {' credits'}
      </p>
      {caption ? <p className="solvapay-mcp-muted">{caption}</p> : null}
    </div>
  )
}

function ProductRow({
  product,
  locale,
  showChangePlan,
  changePlanLabel,
  onChangePlan,
}: {
  product: ActiveProduct
  locale: string
  showChangePlan: boolean
  changePlanLabel: string
  onChangePlan?: () => void
}) {
  return (
    <div className="solvapay-mcp-product-row">
      <div className="solvapay-mcp-product-row-body">
        <div className="solvapay-mcp-plan-row-name">
          <span>{product.productName}</span>
          <StatusDot label="Active" />
        </div>
        <p className="solvapay-mcp-muted">{formatProductTerms(product, locale)}</p>
      </div>
      {showChangePlan && onChangePlan ? (
        <button type="button" className="solvapay-mcp-link-button" onClick={onChangePlan}>
          {changePlanLabel}
        </button>
      ) : null}
    </div>
  )
}

function rowPlanAction(
  product: ActiveProduct,
  plans: readonly PlanLike[] | undefined,
  copy: ReturnType<typeof useCopy>,
): { label: string; show: boolean } {
  const catalogPlan = findCatalogPlan(plans, { reference: product.planRef }, product.planRef)
  const planForActions = mergePlanSnapshot(
    { reference: product.planRef, isMetered: product.isMetered, price: product.amount },
    catalogPlan,
  )
  const paidPlanCount = (plans ?? []).filter(plan => resolvePlanShape(plan) !== 'free').length
  const actions = resolvePlanActions({
    purchase: { planSnapshot: planForActions, hasPaymentMethod: false },
    planCount: plans?.length ?? 0,
    paidPlanCount,
  })
  if (actions.upgrade) return { label: copy.account.upgradeButton, show: true }
  if (actions.changePlan) return { label: copy.account.changePlanButton, show: true }
  return { label: copy.account.changePlanButton, show: false }
}

function formatFiatEquivalent({
  credits,
  displayCurrency,
  creditsPerMinorUnit,
  displayExchangeRate,
  locale,
}: {
  credits: number
  displayCurrency: string | null
  creditsPerMinorUnit: number | null
  displayExchangeRate: number | null
  locale: string
}): string | null {
  if (!displayCurrency || !creditsPerMinorUnit) return null
  const displayMinor = creditsToDisplayMinorUnits({
    credits,
    creditsPerMinorUnit,
    displayExchangeRate: displayExchangeRate ?? 1,
    displayCurrency,
  })
  if (displayMinor === null) return null
  const minorPerMajor = minorUnitsPerMajor(displayCurrency)
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: displayCurrency,
    minimumFractionDigits: minorPerMajor === 1 ? 0 : 2,
  }).format(displayMinor / minorPerMajor)
}
