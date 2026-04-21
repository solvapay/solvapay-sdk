'use client'

/**
 * `<McpAccountView>` — the "manage your SolvaPay account" screen surfaced
 * by the `open_account` MCP tool.
 *
 * Composes existing SDK primitives only — zero new components. Sections:
 *  - `<CurrentPlanCard>` — styled summary with price, renewal date, and an
 *    inline `<CancelPlanButton>` when the purchase is active.
 *  - `<BalanceBadge>` — only shown for usage-based/credit-backed plans.
 *  - `<CancelledPlanNotice>` — reactivate path for a cancelled purchase
 *    that still has access. Renders nothing when no cancelled purchase.
 *  - `<LaunchCustomerPortalButton>` — escape hatch into the hosted portal
 *    for card/invoice management.
 */

import React from 'react'
import { CurrentPlanCard } from '../../components/CurrentPlanCard'
import { LaunchCustomerPortalButton } from '../../components/LaunchCustomerPortalButton'
import { useBalance } from '../../hooks/useBalance'
import { usePurchase } from '../../hooks/usePurchase'
import { usePurchaseStatus } from '../../hooks/usePurchaseStatus'
import { BalanceBadge } from '../../primitives/BalanceBadge'
import { CancelledPlanNotice } from '../../primitives/CancelledPlanNotice'
import { resolveMcpClassNames, type McpViewClassNames } from './types'

export interface McpAccountViewProps {
  classNames?: McpViewClassNames
}

export function McpAccountView({ classNames }: McpAccountViewProps) {
  const cx = resolveMcpClassNames(classNames)
  const { loading, isRefetching, hasPaidPurchase } = usePurchase()
  const { shouldShowCancelledNotice } = usePurchaseStatus()
  const { credits } = useBalance()

  if (loading) {
    return (
      <div className={cx.card}>
        <p>Loading account…</p>
      </div>
    )
  }

  const hasAnyPlan = hasPaidPurchase || shouldShowCancelledNotice
  const hasCredits = (credits ?? 0) > 0

  return (
    <div className={cx.card} data-refreshing={isRefetching ? 'true' : undefined}>
      {hasPaidPurchase ? <CurrentPlanCard /> : null}

      <CancelledPlanNotice.Root className={cx.notice}>
        <CancelledPlanNotice.Heading />
        <CancelledPlanNotice.Expires />
        <CancelledPlanNotice.DaysRemaining className={cx.muted} />
        <CancelledPlanNotice.ReactivateButton className={cx.button} />
      </CancelledPlanNotice.Root>

      {!hasAnyPlan && hasCredits && (
        <div>
          <h2 className={cx.heading}>{"You're on pay-as-you-go credits"}</h2>
          <p className={cx.muted}>
            Top up to keep going, or choose a plan from the checkout view for predictable
            monthly billing.
          </p>
        </div>
      )}

      {!hasAnyPlan && !hasCredits && (
        <div>
          <h2 className={cx.heading}>{"You don't have an active plan"}</h2>
          <p className={cx.muted}>
            Purchase a plan from the checkout view, or activate a free or trial plan if your
            product offers one.
          </p>
        </div>
      )}

      <div className={cx.balanceRow}>
        <span className={cx.muted}>Balance</span>
        <BalanceBadge />
      </div>

      <LaunchCustomerPortalButton
        className={`${cx.button} ${cx.linkButton}`.trim()}
        loadingClassName={cx.button}
        errorClassName={cx.button}
      >
        Manage billing
      </LaunchCustomerPortalButton>
    </div>
  )
}
