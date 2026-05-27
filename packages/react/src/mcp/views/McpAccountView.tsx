'use client'

/**
 * `<McpAccountView>` — the "manage your SolvaPay account" screen surfaced
 * by the `manage_account` MCP tool.
 *
 * One primary card carries the billing state for the current action.
 * Product name and description live in the host/tool text — not here.
 * Customer/seller identity cards render inline on narrow iframes or in
 * the shell sidebar on wide frames via `hideDetailCards`.
 *
 * The plan card has four shapes, picked by the customer's actual state:
 *
 *  - **Active paid purchase** — `<CurrentPlanCard>` with plan name, price,
 *    balance/usage, payment method, and a `<LaunchCustomerPortalButton>`
 *    ("Manage account") below.
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
import { McpCustomerDetailsCard, McpSellerDetailsCard } from './detail-cards'
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
   * pay-as-you-go credit card or the Customer details card.
   * `<McpAppShell>` wires this to a tab switch so nothing re-mounts.
   */
  onTopup?: () => void
  /**
   * Called when the user clicks "Pick a plan" from the empty state or
   * "See plans" on the pay-as-you-go state. Wired by the shell to
   * switch to the checkout surface.
   */
  onChangePlan?: () => void
  /**
   * Skip the Customer + Seller detail cards. `<McpAppShell>` sets this
   * when it mounts the persistent right-hand sidebar (whenever
   * `bootstrap.customer` is set) so the cards are not duplicated.
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

  const hasAnyPlan = hasPaidPurchase || shouldShowCancelledNotice
  const hasCredits = (credits ?? 0) > 0
  // The portal only meaningfully serves paid plans with a non-zero
  // amount (free plans have nothing to manage in Stripe). The hint
  // and the button must use the same gate or the hint will point at
  // a button that never renders.
  const showPortalCta = Boolean(
    hasPaidPurchase && activePurchase && activePurchase.amount && activePurchase.amount > 0,
  )

  return (
    <div className="solvapay-mcp-account">
      <div className={cx.card}>
        {hasPaidPurchase ? (
          <>
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
              showStartDate
              showReference
            />
            {showPortalCta ? (
              <p className={cx.muted} data-solvapay-mcp-portal-hint="">
                {copy.currentPlan.portalHint}
              </p>
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

        {showPortalCta ? (
          <LaunchCustomerPortalButton
            className={cx.button}
            loadingClassName={cx.button}
            errorClassName={cx.button}
          />
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
