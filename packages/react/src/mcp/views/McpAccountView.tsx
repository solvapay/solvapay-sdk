'use client'

/**
 * `<McpAccountView>` — manage-account surface for the `account` viewer.
 *
 * Routes on `resolveAccountState()`: B/D → credit, C/E → allowance,
 * A/F → plan ladder, G/H/I/J → forced data states.
 */

import React from 'react'
import { useLocale } from '../../hooks/useCopy'
import { usePurchase } from '../../hooks/usePurchase'
import { useLimits } from '../../hooks/useLimits'
import type { BootstrapProduct } from '@solvapay/mcp-core'
import {
  resolveAccountState,
  type AccountLimitsLike,
} from '../account-state'
import { deriveActiveProducts } from '../derive-active-products'
import { useDisplayMode } from '../hooks/useDisplayMode'
import {
  findCatalogPlan,
  mergePlanSnapshot,
  resolvePlanShape,
  type PlanLike,
} from '../plan-actions'
import { AllowanceAccountPanel } from './AllowanceAccountPanel'
import { CreditAccountPanel } from './CreditAccountPanel'
import { ForcedAccountPanel } from './ForcedAccountPanel'
import { LadderAccountPanel } from './LadderAccountPanel'
import { type McpViewClassNames } from './types'

export interface McpAccountViewProps {
  /**
   * Invoked product. Used as the identity header on credit and allowance
   * states.
   */
  product?: Pick<BootstrapProduct, 'name' | 'description'> | null
  /** Scopes active products and `useLimits` to this invocation. */
  productRef?: string
  classNames?: McpViewClassNames
  /**
   * Called when the user clicks "Add funds" or "Turn on". `<McpAppShell>`
   * wires this to a surface swap so nothing re-mounts.
   */
  onTopup?: () => void
  /**
   * Called when the user clicks "Pick a plan" or Change plan.
   * Wired by the shell to switch to checkout.
   */
  onChangePlan?: () => void
  /**
   * Product catalog used to decide Upgrade vs Change plan. The shell
   * passes `bootstrap.plans`.
   */
  plans?: readonly PlanLike[]
}

export function McpAccountView({
  product,
  productRef,
  classNames,
  onTopup,
  onChangePlan,
  plans,
}: McpAccountViewProps) {
  const locale = useLocale() ?? 'en'
  const { displayMode } = useDisplayMode()
  const isFullscreen = displayMode === 'fullscreen'
  const { loading, hasPaidPurchase, activePurchase, purchases } = usePurchase()
  const limits = useLimits({ productRef, enabled: Boolean(productRef) })

  const products = deriveActiveProducts(purchases, productRef)
  const showPortalCta = Boolean(
    isFullscreen &&
      hasPaidPurchase &&
      activePurchase &&
      activePurchase.amount &&
      activePurchase.amount > 0,
  )

  const catalogPlan = findCatalogPlan(plans, activePurchase?.planSnapshot, activePurchase?.planRef)
  const planForActions = mergePlanSnapshot(activePurchase?.planSnapshot, catalogPlan)
  const planShape = resolvePlanShape(planForActions)
  const accountLimits: AccountLimitsLike | null = productRef
    ? {
        remaining: limits.remaining,
        withinLimits: limits.withinLimits,
        activationRequired: limits.activationRequired,
        overage: limits.overage,
        needsTopUp: limits.needsTopUp,
        needsUpgrade: limits.needsUpgrade,
        throttled: limits.throttled,
      }
    : null
  const accountState = resolveAccountState({
    loading: loading || Boolean(productRef && limits.loading),
    purchase: activePurchase,
    limits: accountLimits,
    planShape,
  })

  if (accountState === 'B' || accountState === 'D') {
    return (
      <CreditAccountPanel
        accountState={accountState}
        product={product}
        creditProduct={products[0]}
        planForActions={planForActions}
        plans={plans}
        locale={locale}
        classNames={classNames}
        onTopup={onTopup}
        onChangePlan={onChangePlan}
        showPortalCta={showPortalCta}
      />
    )
  }

  if (accountState === 'C' || accountState === 'E') {
    return (
      <AllowanceAccountPanel
        accountState={accountState}
        product={product}
        allowanceProduct={products[0]}
        planForActions={planForActions}
        planShape={planShape}
        productRef={productRef}
        plans={plans}
        locale={locale}
        classNames={classNames}
        onChangePlan={onChangePlan}
        showPortalCta={showPortalCta}
      />
    )
  }

  if (accountState === 'A' || accountState === 'F') {
    return (
      <LadderAccountPanel
        accountState={accountState}
        product={product}
        allowanceProduct={products[0]}
        planForActions={planForActions}
        planShape={planShape}
        plans={plans}
        productRef={productRef}
        locale={locale}
        classNames={classNames}
        onChangePlan={onChangePlan}
        showPortalCta={showPortalCta}
      />
    )
  }

  return (
    <ForcedAccountPanel
      accountState={accountState}
      product={product}
      allowanceProduct={products[0]}
      planForActions={planForActions}
      plans={plans}
      productRef={productRef}
      locale={locale}
      classNames={classNames}
      onChangePlan={onChangePlan}
      showPortalCta={showPortalCta}
    />
  )
}
