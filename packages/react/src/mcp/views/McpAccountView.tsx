'use client'

/**
 * `<McpAccountView>` — the "manage your SolvaPay account" screen surfaced
 * by the `manage_account` MCP tool.
 *
 * One primary card carries the billing state for the current action.
 * Product name and description live in the host/tool text — not here.
 * Seller / customer identity lives on the shell provenance line.
 *
 * The plan card has four shapes, picked by the customer's actual state:
 *
 *  - **Active purchase** — `<CurrentPlanCard>` with plan name, price or
 *    usage rate, and an Upgrade / Change plan CTA when the catalog has
 *    alternatives. Paid plans with `amount > 0` also get a
 *    `<LaunchCustomerPortalButton>` ("Manage account") below.
 *  - **Cancelled-but-active purchase** — `<CancelledPlanNotice>` with
 *    its reactivate button.
 *  - **Pay-as-you-go credits, no plan** — compact balance card with
 *    `Credits` heading, `<BalanceBadge>`, `Top up`, and `See plans`.
 *  - **No plan, no credits** — empty-state card with `Pick a plan` CTA.
 */

import React from 'react'
import { CurrentPlanCard } from '../../components/CurrentPlanCard'
import { LaunchCustomerPortalButton } from '../../components/LaunchCustomerPortalButton'
import { useBalance } from '../../hooks/useBalance'
import { useCopy } from '../../hooks/useCopy'
import { usePurchase } from '../../hooks/usePurchase'
import { usePurchaseStatus } from '../../hooks/usePurchaseStatus'
import { BalanceBadge } from '../../primitives/BalanceBadge'
import { CancelledPlanNotice } from '../../primitives/CancelledPlanNotice'
import type { BootstrapProduct } from '@solvapay/mcp-core'
import {
  findCatalogPlan,
  mergePlanSnapshot,
  resolvePlanActions,
  resolvePlanShape,
  type PlanLike,
} from '../plan-actions'
import { resolveMcpClassNames, type McpViewClassNames } from './types'

export interface McpAccountViewProps {
  /**
   * @deprecated Product context is not rendered in the account surface.
   * Kept for integrators who pass `bootstrap.product` through custom views.
   */
  product?: Pick<BootstrapProduct, 'name' | 'description'> | null
  classNames?: McpViewClassNames
  /**
   * Called when the user clicks the "Top up" link inside the
   * pay-as-you-go credit card. `<McpAppShell>` wires this to a
   * surface swap so nothing re-mounts.
   */
  onTopup?: () => void
  /**
   * Called when the user clicks "Pick a plan" from the empty state,
   * "See plans" on the credits-only state, or Upgrade / Change plan
   * on an active plan. Wired by the shell to switch to checkout.
   */
  onChangePlan?: () => void
  /**
   * Product catalog used to decide Upgrade vs Change plan and to
   * format a PAYG rate when the purchase snapshot is thin. The shell
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
  const { loading, hasPaidPurchase, activePurchase } = usePurchase()
  const { shouldShowCancelledNotice } = usePurchaseStatus()
  const { credits } = useBalance()

  if (loading) {
    return (
      <div className={cx.card}>
        <p>Loading account…</p>
      </div>
    )
  }

  const hasAnyPlan = Boolean(activePurchase) || shouldShowCancelledNotice
  const hasCredits = (credits ?? 0) > 0
  // The portal only meaningfully serves paid plans with a non-zero
  // amount (free plans have nothing to manage in Stripe). The hint
  // and the button must use the same gate or the hint will point at
  // a button that never renders.
  const showPortalCta = Boolean(
    hasPaidPurchase && activePurchase && activePurchase.amount && activePurchase.amount > 0,
  )

  const catalogPlan = findCatalogPlan(plans, activePurchase?.planSnapshot, activePurchase?.planRef)
  const planForActions = mergePlanSnapshot(activePurchase?.planSnapshot, catalogPlan)
  const paidPlanCount = (plans ?? []).filter(plan => resolvePlanShape(plan) !== 'free').length
  const actions = resolvePlanActions({
    purchase: {
      planSnapshot: planForActions,
      hasPaymentMethod: false,
    },
    planCount: plans?.length ?? 0,
    paidPlanCount,
  })
  const showChangePlanCta = Boolean(onChangePlan && (actions.upgrade || actions.changePlan))

  return (
    <div className="solvapay-mcp-account">
      <div className={cx.card}>
        {activePurchase ? (
          <>
            {/* Surface title, mirroring `Choose a plan` on checkout and
             *  `Add credits` on topup — every MCP surface names its job
             *  in the same slot. Rendered here rather than through the
             *  card's own `<h2>` so it inherits the shared step-heading
             *  treatment as a direct child of `.solvapay-mcp-card`. */}
            <h2 className={cx.heading}>{copy.currentPlan.heading}</h2>
            {/* TODO(mcp-host-cancel): inline `<CancelPlanButton>` doesn't fire
             *  reliably inside the MCP host iframe — likely a sandboxed
             *  `window.confirm()` or a `cancel_purchase` tool gap. Until
             *  that's root-caused, the card collapses to a single
             *  "Manage account" CTA below; cancellation runs through the
             *  Stripe portal instead. Tracked separately. */}
            <CurrentPlanCard
              hideHeading
              hideProductContext
              hideUpdatePaymentButton
              hideCancelButton
              hideCancelledNotice
              hidePaymentMethod
              showStartDate
              showFieldLabels
              plans={plans}
            />
            {showChangePlanCta ? (
              <button type="button" className={cx.button} onClick={onChangePlan}>
                {actions.upgrade ? copy.account.upgradeButton : copy.account.changePlanButton}
              </button>
            ) : null}
          </>
        ) : null}

        <CancelledPlanNotice.Root className={cx.notice}>
          <CancelledPlanNotice.Heading />
          <CancelledPlanNotice.Expires />
          <CancelledPlanNotice.DaysRemaining className={cx.muted} />
          <CancelledPlanNotice.ReactivateButton className={cx.button} />
        </CancelledPlanNotice.Root>

        {!hasAnyPlan && hasCredits && (
          <div className={`${cx.stack} solvapay-mcp-account-credit-stack`.trim()}>
            <h2 className={cx.heading}>{copy.account.payAsYouGoTitle}</h2>
            <BalanceBadge />
            <div className={cx.balanceRow}>
              {onTopup ? (
                <button type="button" className={cx.button} onClick={onTopup}>
                  Top up
                </button>
              ) : null}
              {onChangePlan ? (
                <button type="button" className={cx.linkButton} onClick={onChangePlan}>
                  {copy.account.seePlansButton}
                </button>
              ) : null}
            </div>
          </div>
        )}

        {!hasAnyPlan && !hasCredits && (
          <div className={cx.stack}>
            <h2 className={cx.heading}>{copy.account.noPlanTitle}</h2>
            <p className={cx.muted}>{copy.account.noPlanBody}</p>
            {onChangePlan ? (
              <button type="button" className={cx.button} onClick={onChangePlan}>
                {copy.account.pickPlanButton}
              </button>
            ) : null}
          </div>
        )}

        {/* The hint names the button by label ("Click Manage account
         *  to …"), so it has to sit with it rather than under the plan
         *  card with the Change plan CTA in between. */}
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
