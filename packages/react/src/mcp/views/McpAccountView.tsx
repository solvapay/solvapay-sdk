'use client'

/**
 * `<McpAccountView>` — the "manage your SolvaPay account" screen surfaced
 * by the `manage_account` MCP tool.
 *
 * Mirrors the hosted manage page's information hierarchy: the product
 * name + description lead the surface, a `CURRENT PLAN AND USAGE`
 * section label sits above the active plan card, and the
 * customer/seller identity cards stack below (or off to the sidebar
 * via `hideDetailCards`).
 *
 * The plan card has four shapes, picked by the customer's actual state:
 *
 *  - **Active paid purchase** — `<CurrentPlanCard>` with `Started …` and
 *    `pur_…` reference lines, plus the `<UsageMeter>` for usage-based
 *    plans. Inline cancel/update are deliberately hidden in favour of
 *    a single `<LaunchCustomerPortalButton>` ("Manage account") below.
 *  - **Cancelled-but-active purchase** — `<CancelledPlanNotice>` with
 *    its reactivate button.
 *  - **Pay-as-you-go credits, no plan** — in-card framing of the credit
 *    balance with an inline `Top up` button and a `See plans` link.
 *  - **No plan, no credits** — empty-state card with `Pick a plan` CTA.
 *
 * The product header and section label render in every state so the
 * customer always sees which product they're managing — same framing
 * as the hosted page even when no purchase is in flight yet.
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
   * Product whose account the customer is managing. Sourced from
   * `bootstrap.product` by `<McpAppShell>`. When omitted, the view
   * falls back to the active purchase's `productName` (legacy).
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
   * Refresh the bootstrap snapshot when the user clicks the inline
   * refresh icon on the section label row. Optional — when unset the
   * icon button is hidden.
   */
  onRefresh?: () => void | Promise<void>
  /**
   * Skip the Customer + Seller detail cards. `<McpAppShell>` sets this
   * to `true` at the wide-iframe breakpoint because the same cards
   * render in the persistent right-hand sidebar.
   */
  hideDetailCards?: boolean
}

export function McpAccountView({
  product,
  classNames,
  onTopup,
  onChangePlan,
  onRefresh,
  hideDetailCards,
}: McpAccountViewProps) {
  const cx = resolveMcpClassNames(classNames)
  const copy = useCopy()
  const { loading, isRefetching, hasPaidPurchase, activePurchase } = usePurchase()
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

  // Product name falls back to the active purchase's productName for
  // legacy callers (and unauthenticated bootstraps where `product` is
  // unavailable). Description is product-only — no purchase-level
  // fallback exists.
  const productName = product?.name ?? activePurchase?.productName ?? null
  const productDescription = product?.description ?? null

  return (
    <div className="solvapay-mcp-account" data-refreshing={isRefetching ? 'true' : undefined}>
      {productName ? (
        <header className={cx.productHeader} data-solvapay-mcp-product-header="">
          <h1 className={cx.productName}>{productName}</h1>
          {productDescription ? (
            <p className={cx.productDescription}>{productDescription}</p>
          ) : null}
        </header>
      ) : null}

      <div className={cx.sectionLabelRow}>
        <span className={cx.sectionLabel} data-solvapay-mcp-section-label="">
          {copy.account.currentPlanAndUsage}
        </span>
        {onRefresh ? (
          <button
            type="button"
            className={cx.refreshButton}
            onClick={() => void onRefresh()}
            aria-label={copy.account.refreshLabel}
            data-solvapay-mcp-refresh-button=""
          >
            <RefreshGlyph />
          </button>
        ) : null}
      </div>

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
              showStartDate
              showReference
            />
            <p className={cx.muted} data-solvapay-mcp-portal-hint="">
              {copy.currentPlan.portalHint}
            </p>
          </>
        ) : null}

        <CancelledPlanNotice.Root className={cx.notice}>
          <CancelledPlanNotice.Heading />
          <CancelledPlanNotice.Expires />
          <CancelledPlanNotice.DaysRemaining className={cx.muted} />
          <CancelledPlanNotice.ReactivateButton className={cx.button} />
        </CancelledPlanNotice.Root>

        {!hasAnyPlan && hasCredits && (
          <div className={cx.stack}>
            <h2 className={cx.heading}>{copy.account.payAsYouGoTitle}</h2>
            <BalanceBadge />
            <p className={cx.muted}>{copy.account.payAsYouGoBody}</p>
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

        {hasPaidPurchase && activePurchase && activePurchase.amount && activePurchase.amount > 0 ? (
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

/**
 * Inline refresh icon — circular arrow. SVG-only so the SDK doesn't
 * pull a peer-dep on an icon library, and the stroke colour inherits
 * `currentColor` so theme tokens drive it.
 */
function RefreshGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-3.5-7.1" />
      <polyline points="21 4 21 10 15 10" />
    </svg>
  )
}
