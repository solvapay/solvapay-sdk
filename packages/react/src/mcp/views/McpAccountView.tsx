'use client'

/**
 * `<McpAccountView>` — the "manage your SolvaPay account" screen surfaced
 * by the `manage_account` MCP tool.
 *
 * Now folds the former "Credits" tab content inline: when the active
 * purchase has a meter, `<UsageMeter>` renders above the plan card;
 * when the customer holds credits, a prominent balance row with an
 * inline "Top up" button sits at the top.
 *
 * Composes existing SDK primitives only — zero new components. Sections:
 *  - Balance card (with inline Top up) — only when credits > 0 or a
 *    usage-based plan is active.
 *  - `<UsageMeter>` — only when the active plan has a meter / limit.
 *  - `<CurrentPlanCard>` — styled summary with price, renewal date, and an
 *    inline `<CancelPlanButton>` when the purchase is active.
 *  - `<CancelledPlanNotice>` — reactivate path for a cancelled purchase
 *    that still has access. Renders nothing when no cancelled purchase.
 *  - `<McpCustomerDetailsCard>` / `<McpSellerDetailsCard>` — identity +
 *    trust-signal cards ported from the hosted manage page. Same markup
 *    powers the wide-iframe sidebar in `<McpAppShell>`.
 *  - `<LaunchCustomerPortalButton>` — escape hatch into the hosted portal
 *    for card/invoice management.
 */

import React from 'react'
import { CurrentPlanCard } from '../../components/CurrentPlanCard'
import { LaunchCustomerPortalButton } from '../../components/LaunchCustomerPortalButton'
import { useBalance } from '../../hooks/useBalance'
import { usePurchase } from '../../hooks/usePurchase'
import { usePurchaseStatus } from '../../hooks/usePurchaseStatus'
import { useUsage } from '../../hooks/useUsage'
import { BalanceBadge } from '../../primitives/BalanceBadge'
import { CancelledPlanNotice } from '../../primitives/CancelledPlanNotice'
import { UsageMeter } from '../../primitives/UsageMeter'
import { McpCustomerDetailsCard, McpSellerDetailsCard } from './detail-cards'
import { resolveMcpClassNames, type McpViewClassNames } from './types'

export interface McpAccountViewProps {
  classNames?: McpViewClassNames
  /**
   * Called when the user clicks the "Top up" link inside the balance
   * row or Customer details card. The `<McpAppShell>` wires this to a
   * tab switch so nothing re-mounts; consumers outside the shell can
   * leave it unset.
   */
  onTopup?: () => void
  /**
   * Called when the user clicks "Pick a plan" from the empty state or
   * "Change plan" / "Upgrade" on the plan card. Wired by the shell to
   * switch to the Plan tab.
   */
  onChangePlan?: () => void
  /**
   * Skip the Customer + Seller detail cards. `<McpAppShell>` sets this
   * to `true` at the `xl` breakpoint because the same cards render in
   * the persistent right-hand sidebar.
   */
  hideDetailCards?: boolean
}

export function McpAccountView({
  classNames,
  onTopup,
  onChangePlan,
  hideDetailCards,
}: McpAccountViewProps) {
  const cx = resolveMcpClassNames(classNames)
  const { loading, isRefetching, hasPaidPurchase, activePurchase } = usePurchase()
  const { shouldShowCancelledNotice } = usePurchaseStatus()
  const { credits } = useBalance()
  const { usage } = useUsage()

  if (loading) {
    return (
      <div className={cx.card}>
        <p>Loading account…</p>
      </div>
    )
  }

  const hasAnyPlan = hasPaidPurchase || shouldShowCancelledNotice
  const hasCredits = (credits ?? 0) > 0
  const planSnapshot = activePurchase?.planSnapshot
  const planType = planSnapshot?.planType
  const isUsageBased = planType === 'usage-based'
  const hasMeter = usage != null || Boolean(planSnapshot?.meterRef)

  return (
    <div className="solvapay-mcp-account" data-refreshing={isRefetching ? 'true' : undefined}>
      {(hasCredits || isUsageBased) ? (
        <section className={cx.card} aria-label="Credit balance">
          <div className={cx.balanceRow}>
            <div>
              <h2 className={cx.heading}>Credit balance</h2>
              <BalanceBadge />
            </div>
            {onTopup ? (
              <button type="button" className={cx.button} onClick={onTopup}>
                Top up
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {hasMeter ? (
        <section className={cx.card} aria-label="Usage">
          <UsageMeter.Root>
            <UsageMeter.Label />
            <UsageMeter.Bar />
            <UsageMeter.Percentage />
            <UsageMeter.ResetsIn />
            <UsageMeter.Loading />
            <UsageMeter.Empty />
          </UsageMeter.Root>
        </section>
      ) : null}

      <div className={cx.card}>
        {hasPaidPurchase ? <CurrentPlanCard /> : null}

        <CancelledPlanNotice.Root className={cx.notice}>
          <CancelledPlanNotice.Heading />
          <CancelledPlanNotice.Expires />
          <CancelledPlanNotice.DaysRemaining className={cx.muted} />
          <CancelledPlanNotice.ReactivateButton className={cx.button} />
        </CancelledPlanNotice.Root>

        {!hasAnyPlan && hasCredits && (
          <div className={cx.stack}>
            <h2 className={cx.heading}>{"You're on pay-as-you-go credits"}</h2>
            <p className={cx.muted}>
              Top up to keep going, or choose a plan from the Plan tab for predictable
              monthly billing.
            </p>
            {onChangePlan ? (
              <button type="button" className={cx.linkButton} onClick={onChangePlan}>
                See plans
              </button>
            ) : null}
          </div>
        )}

        {!hasAnyPlan && !hasCredits && (
          <div className={cx.stack}>
            <h2 className={cx.heading}>{"You don't have an active plan"}</h2>
            <p className={cx.muted}>
              Pick a plan — free, pay-as-you-go, or paid — from the Plan tab.
            </p>
            {onChangePlan ? (
              <button type="button" className={cx.button} onClick={onChangePlan}>
                Pick a plan
              </button>
            ) : null}
          </div>
        )}

        {hasPaidPurchase && activePurchase && activePurchase.amount && activePurchase.amount > 0 ? (
          <LaunchCustomerPortalButton
            className={cx.button}
            loadingClassName={cx.button}
            errorClassName={cx.button}
          >
            Manage billing
          </LaunchCustomerPortalButton>
        ) : null}
      </div>

      {!hideDetailCards ? (
        <>
          <McpCustomerDetailsCard classNames={classNames} onTopup={onTopup} />
          <McpSellerDetailsCard classNames={classNames} />
        </>
      ) : null}
    </div>
  )
}
