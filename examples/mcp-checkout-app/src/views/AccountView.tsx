/**
 * AccountView — the "manage your SolvaPay account" screen surfaced by the
 * `open_account` MCP tool.
 *
 * Composes existing SDK primitives only — zero new components. The intent
 * is to prove the `open_account` UX against real SDK hooks inside the MCP
 * host sandbox; anything that proves durable will be lifted into
 * `@solvapay/react/mcp` as a compound primitive in a follow-up plan.
 *
 * Sections:
 *  - `<CurrentPlanCard>` — styled summary with price, renewal date, and an
 *    inline `<CancelPlanButton>` when the purchase is active. Renders an
 *    upgrade CTA when the customer has no active purchase.
 *  - `<BalanceBadge>` — only shown for usage-based/credit-backed plans
 *    (elided when the hook reports `credits == null`).
 *  - `<CancelledPlanNotice>` — reactivate path for a purchase that was
 *    cancelled but still has access. The primitive renders nothing when
 *    there's no cancelled purchase, so it's safe to mount unconditionally.
 *  - `<LaunchCustomerPortalButton>` — escape hatch into the hosted portal
 *    for card/invoice management we don't (yet) embed.
 */

import React from 'react'
import {
  CurrentPlanCard,
  LaunchCustomerPortalButton,
  useBalance,
  usePurchase,
  usePurchaseStatus,
} from '@solvapay/react'
import { BalanceBadge, CancelledPlanNotice } from '@solvapay/react/primitives'

export function AccountView() {
  const { loading, isRefetching, hasPaidPurchase } = usePurchase()
  const { shouldShowCancelledNotice } = usePurchaseStatus()
  const { credits } = useBalance()

  if (loading) {
    return (
      <div className="checkout-card">
        <p>Loading account…</p>
      </div>
    )
  }

  const hasAnyPlan = hasPaidPurchase || shouldShowCancelledNotice
  const hasCredits = (credits ?? 0) > 0

  return (
    <div className="checkout-card" data-refreshing={isRefetching ? 'true' : undefined}>
      {hasPaidPurchase ? <CurrentPlanCard /> : null}

      <CancelledPlanNotice.Root className="checkout-notice">
        <CancelledPlanNotice.Heading />
        <CancelledPlanNotice.Expires />
        <CancelledPlanNotice.DaysRemaining className="checkout-muted" />
        <CancelledPlanNotice.ReactivateButton className="hosted-button" />
      </CancelledPlanNotice.Root>

      {!hasAnyPlan && hasCredits && (
        <div>
          <h2>You're on pay-as-you-go credits</h2>
          <p className="checkout-muted">
            Top up to keep going, or choose a plan from the checkout view for predictable
            monthly billing.
          </p>
        </div>
      )}

      {!hasAnyPlan && !hasCredits && (
        <div>
          <h2>You don't have an active plan</h2>
          <p className="checkout-muted">
            Purchase a plan from the checkout view, or activate a free or trial plan if your
            product offers one.
          </p>
        </div>
      )}

      <div className="account-balance-row">
        <span className="checkout-muted">Balance</span>
        <BalanceBadge />
      </div>

      <LaunchCustomerPortalButton
        className="hosted-button hosted-button-link"
        loadingClassName="hosted-button"
        errorClassName="hosted-button"
      >
        Manage billing
      </LaunchCustomerPortalButton>
    </div>
  )
}
