'use client'

/**
 * `<McpAppShell>` — thin in-iframe layout wrapping `<McpViewRouter>`.
 *
 * The shell is surface-routed, not tab-routed: `bootstrap.view` locks
 * the rendered surface for the invocation's lifetime. There is no tab
 * strip and no in-session surface switching from the user, only the
 * paywall / nudge `upgradeCta` flip that swaps the body to the
 * checkout view via the `overrideView` state.
 *
 * Surfaces rendered via `<McpViewRouter>`:
 *  - `checkout` — plan picker + activation dispatcher.
 *  - `account`  — current plan, balance, usage, payment method.
 *  - `topup`    — amount picker + Stripe.
 *  - `paywall`  — gate-response takeover; no sidebar, no footer.
 *  - `nudge`    — merchant tool result + upsell strip; no sidebar, no footer.
 *
 * Legacy bootstrap `view: 'about' | 'activate' | 'usage'` values fall
 * through to the appropriate surface inside `<McpViewRouter>` — about
 * and activate collapse into `checkout`, usage into `account`.
 */

import React, { useEffect, useRef, useState } from 'react'
import { useMerchant } from '../hooks/useMerchant'
// `STALE_THRESHOLD_MS` was used by the tab-era refresh debounce; the
// mount-once refresh below doesn't need it.
import type { McpBootstrap } from './bootstrap'
import type { McpAppViewOverrides } from './McpApp'
import type { McpViewKind } from './view-kind'
import {
  McpAccountView,
  type McpAccountViewProps,
} from './views/McpAccountView'
import { McpCustomerDetailsCard, McpSellerDetailsCard } from './views/detail-cards'
import {
  McpCheckoutView,
  type McpCheckoutViewProps,
} from './views/McpCheckoutView'
import {
  McpPaywallView,
  type McpPaywallViewProps,
} from './views/McpPaywallView'
import {
  McpTopupView,
  type McpTopupViewProps,
} from './views/McpTopupView'
import {
  McpNudgeView,
  type McpNudgeViewProps,
} from './views/McpNudgeView'
import { resolveMcpClassNames, type McpViewClassNames } from './views/types'

export interface McpAppShellProps {
  bootstrap: McpBootstrap
  views?: McpAppViewOverrides
  classNames?: McpViewClassNames
  /** Render the footer? Defaults to `true` when the merchant has any of support/terms/privacy URLs. */
  footer?: boolean
  /**
   * Refresh the bootstrap snapshot. Wired by `<McpApp>` to
   * `SolvaPayProvider.refreshInitial`. The shell calls this once on
   * mount so stale caches get re-seeded when the user re-opens the
   * MCP app after backgrounding it. Errors are swallowed (soft signal).
   */
  onRefreshBootstrap?: () => void | Promise<void>
  /**
   * Ask the host to unmount the MCP app. Wired by `<McpApp>` to
   * `app.requestTeardown()`. The checkout view uses this for its
   * `"Back to chat"` success CTA and the `"Stay on Free"` dismiss
   * link. `undefined` hides those affordances so integrators that own
   * their own mount can opt out.
   */
  onClose?: () => void
}

/**
 * Resolve the surface to render. The bootstrap's `view` is the source
 * of truth; legacy kinds (`about`, `activate`, `usage`) collapse into
 * the surviving four surfaces. Undefined bootstrap views default to
 * `account` (same fallback the shell used for its tab-era initialTab).
 */
function resolveSurface(
  bootstrapView: McpBootstrap['view'] | string | undefined,
): McpViewKind {
  switch (bootstrapView) {
    case 'checkout':
    case 'about': // About folds into checkout's picker.
    case 'activate': // Activate merges into the checkout dispatcher.
      return 'checkout'
    case 'topup':
      return 'topup'
    case 'paywall':
      return 'paywall'
    case 'nudge':
      return 'nudge'
    case 'usage': // Usage folds into the account surface.
    case 'account':
    default:
      return 'account'
  }
}

export function McpAppShell({
  bootstrap,
  views,
  classNames,
  footer,
  onRefreshBootstrap,
  onClose,
}: McpAppShellProps) {
  const { merchant } = useMerchant()
  const [paywallDismissed, setPaywallDismissed] = useState(false)
  // The only in-session surface mutation: paywall / nudge CTAs flip
  // the rendered surface to `checkout` without waiting for a host
  // re-invocation. Everything else locks on `bootstrap.view`.
  const [overrideView, setOverrideView] = useState<McpViewKind | null>(null)
  // Sticks once the customer clicks through the paywall takeover so
  // the checkout view can show the "Upgrade to continue" banner and
  // the "Stay on Free" dismiss link. Remains false when the checkout
  // view is reached via `McpAccountView`'s "Change plan" affordance —
  // satisfying the §6 invariant "one flag, one visual, no heuristics."
  const [cameFromPaywall, setCameFromPaywall] = useState(false)

  // Initial entry via `bootstrap.view === 'paywall'` counts as
  // paywall-origin even before the explicit CTA click, so the flag
  // reflects the same semantics whether the host opens the checkout
  // directly with a paywall payload or the customer clicks through
  // the paywall takeover first.
  const initialFromPaywall = bootstrap.view === 'paywall'

  const resolvedView = resolveSurface(bootstrap.view)
  const isPaywall = resolvedView === 'paywall' && !paywallDismissed
  const effectiveView: McpViewKind = overrideView ?? (isPaywall ? 'paywall' : resolvedView)
  const isChrome = effectiveView !== 'paywall' && effectiveView !== 'nudge'
  const fromPaywall = cameFromPaywall || initialFromPaywall

  // Refresh the bootstrap once on mount if the caller wired it. The
  // tabbed shell used to do this on every tab switch; with a single
  // surface per invocation we only need it at mount time so a user
  // re-opening the iframe after backgrounding it sees fresh data.
  // A ref guard keeps it to one call per `onRefreshBootstrap` identity
  // (protects against strict-mode double-mount).
  const refreshedRef = useRef(false)
  useEffect(() => {
    if (!onRefreshBootstrap) return
    if (refreshedRef.current) return
    refreshedRef.current = true
    void Promise.resolve(onRefreshBootstrap()).catch(() => {
      /* best-effort. */
    })
  }, [onRefreshBootstrap])

  const showFooter = footer ?? Boolean(merchant?.termsUrl || merchant?.privacyUrl)
  const isShellSidebarEligible = isChrome && bootstrap.customer !== null

  // Product-driven title; the merchant/brand marker stays above it.
  const productName =
    (bootstrap.product as { name?: string } | undefined)?.name ?? null

  const handlePaywallUpgrade = () => {
    setPaywallDismissed(true)
    setCameFromPaywall(true)
    setOverrideView('checkout')
  }

  const handleNudgeCta = () => {
    setOverrideView('checkout')
  }

  const handleChangePlan = () => {
    // Change-plan from the account view is *not* a paywall flow —
    // clear the flag so the checkout view renders without the banner
    // or the "Stay on Free" dismiss. If `cameFromPaywall` was already
    // false (the usual case), this is a no-op.
    setCameFromPaywall(false)
    setOverrideView('checkout')
  }

  return (
    <div className="solvapay-mcp-shell" data-paywall={isPaywall ? 'true' : undefined}>
      <ShellHeader
        merchant={merchant}
        productName={productName}
        classNames={classNames}
      />

      <div className="solvapay-mcp-shell-layout">
        <div className="solvapay-mcp-shell-body">
          <McpViewRouter
            view={effectiveView}
            bootstrap={bootstrap}
            views={views}
            classNames={classNames}
            suppressDetailCards={isShellSidebarEligible}
            fromPaywall={fromPaywall}
            onSurfaceChange={setOverrideView}
            onPaywallUpgrade={handlePaywallUpgrade}
            onNudgeCta={handleNudgeCta}
            onChangePlan={handleChangePlan}
            onRefreshBootstrap={onRefreshBootstrap}
            onClose={onClose}
          />
        </div>

        {isShellSidebarEligible ? (
          <aside className="solvapay-mcp-shell-sidebar" aria-label="Your account context">
            <McpSellerDetailsCard classNames={classNames} />
            <McpCustomerDetailsCard
              classNames={classNames}
              onTopup={() => setOverrideView('topup')}
            />
          </aside>
        ) : null}
      </div>

      {isChrome && showFooter ? (
        <ShellFooter classNames={classNames} merchant={merchant} />
      ) : null}
    </div>
  )
}

function ShellHeader({
  merchant,
  productName,
  classNames,
}: {
  merchant: ReturnType<typeof useMerchant>['merchant']
  productName: string | null
  classNames?: McpViewClassNames
}) {
  const cx = resolveMcpClassNames(classNames)
  const displayName = merchant?.displayName ?? null
  const logoUrl = merchant?.logoUrl ?? null
  const initials = displayName
    ? displayName
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]!.toUpperCase())
        .join('')
    : 'SP'

  // Fallback chain: product.name → merchant.displayName → 'My account'.
  const headingText = productName ?? displayName ?? 'My account'

  return (
    <header className="solvapay-mcp-shell-header">
      <div className="solvapay-mcp-shell-brand">
        {logoUrl ? (
          <img
            className="solvapay-mcp-shell-logo"
            src={logoUrl}
            alt={displayName ?? 'Merchant logo'}
          />
        ) : (
          <span className="solvapay-mcp-shell-logo-initials" aria-hidden="true">
            {initials}
          </span>
        )}
        {displayName ? (
          <span className="solvapay-mcp-shell-brand-name">{displayName}</span>
        ) : null}
      </div>
      <h1 className={`${cx.heading} solvapay-mcp-shell-title`.trim()}>{headingText}</h1>
    </header>
  )
}

function ShellFooter({
  classNames,
  merchant,
}: {
  classNames?: McpViewClassNames
  merchant: ReturnType<typeof useMerchant>['merchant']
}) {
  const cx = resolveMcpClassNames(classNames)
  const termsUrl = merchant?.termsUrl
  const privacyUrl = merchant?.privacyUrl

  if (!termsUrl && !privacyUrl) {
    return (
      <footer className={`solvapay-mcp-shell-footer ${cx.muted}`.trim()}>
        Provided by SolvaPay
      </footer>
    )
  }

  return (
    <footer className={`solvapay-mcp-shell-footer ${cx.muted}`.trim()}>
      {termsUrl ? (
        <a
          className="solvapay-mcp-shell-footer-link"
          href={termsUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Terms (opens in a new tab)"
        >
          Terms
          <span className="solvapay-mcp-external-glyph" aria-hidden="true">
            {' '}↗
          </span>
        </a>
      ) : null}
      {termsUrl && privacyUrl ? <span aria-hidden="true"> · </span> : null}
      {privacyUrl ? (
        <a
          className="solvapay-mcp-shell-footer-link"
          href={privacyUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Privacy (opens in a new tab)"
        >
          Privacy
          <span className="solvapay-mcp-external-glyph" aria-hidden="true">
            {' '}↗
          </span>
        </a>
      ) : null}
      <span aria-hidden="true"> · </span>
      <span>Provided by SolvaPay</span>
    </footer>
  )
}

export interface McpViewRouterProps {
  /** Surface to render. */
  view: McpViewKind
  bootstrap: McpBootstrap
  views?: McpAppViewOverrides
  classNames?: McpViewClassNames
  /** Whether the shell already renders the customer/seller cards in a sidebar. */
  suppressDetailCards?: boolean
  /**
   * True when the checkout view was reached via the paywall takeover
   * (or the shell mounted with `bootstrap.view === 'paywall'`). Drives
   * the "Upgrade to continue" banner and `"Stay on Free"` dismiss link
   * inside `McpCheckoutView`.
   */
  fromPaywall?: boolean
  /**
   * Called when a surface asks to swap to another surface in-session
   * (only used by the paywall-dismiss and nudge-CTA handlers). The
   * shell wires this to its `overrideView` state.
   */
  onSurfaceChange?: (next: McpViewKind) => void
  /**
   * Paywall-specific upgrade handler forwarded as `upgradeCta.onClick`
   * on `<McpPaywallView>`. Defaults to `onSurfaceChange?.('checkout')`.
   */
  onPaywallUpgrade?: () => void
  /** Nudge-specific CTA handler; defaults to `onSurfaceChange?.('checkout')`. */
  onNudgeCta?: () => void
  /**
   * Invoked when the account view's "Change plan" affordance fires.
   * Clears the `fromPaywall` flag before swapping to `'checkout'` so
   * the banner doesn't render in the change-plan flow.
   */
  onChangePlan?: () => void
  /**
   * Forwarded to `McpCheckoutView`'s `"Back to chat"` success CTA so
   * the shell can reseed its caches before the host unmounts.
   */
  onRefreshBootstrap?: () => void | Promise<void>
  /**
   * Forwarded to `McpCheckoutView`'s `"Back to chat"` and
   * `"Stay on Free"` affordances. Wired by `<McpApp>` to
   * `app.requestTeardown()`.
   */
  onClose?: () => void
}

/**
 * Single `switch` on `McpViewKind` that resolves each view from the
 * `views` override map and threads `bootstrap`-derived props through.
 * Exported so integrators that own their own shell + provider mount
 * can still get view dispatch for free.
 */
export function McpViewRouter({
  view,
  bootstrap,
  views,
  classNames,
  suppressDetailCards,
  fromPaywall,
  onSurfaceChange,
  onPaywallUpgrade,
  onNudgeCta,
  onChangePlan,
  onRefreshBootstrap,
  onClose,
}: McpViewRouterProps): React.ReactNode {
  const { productRef, stripePublishableKey, returnUrl, paywall } = bootstrap
  const CheckoutView = (views?.checkout ?? McpCheckoutView) as React.ComponentType<McpCheckoutViewProps>
  const AccountView = (views?.account ?? McpAccountView) as React.ComponentType<McpAccountViewProps>
  const TopupView = (views?.topup ?? McpTopupView) as React.ComponentType<McpTopupViewProps>
  const PaywallView = (views?.paywall ?? McpPaywallView) as React.ComponentType<McpPaywallViewProps>
  const NudgeView = (views?.nudge ?? McpNudgeView) as React.ComponentType<McpNudgeViewProps>

  const goCheckout = onSurfaceChange ? () => onSurfaceChange('checkout') : undefined
  const goTopup = onSurfaceChange ? () => onSurfaceChange('topup') : undefined
  const goAccount = onSurfaceChange ? () => onSurfaceChange('account') : undefined
  const changePlan = onChangePlan ?? goCheckout
  const nudgeCta = onNudgeCta ?? goCheckout
  const paywallUpgrade = onPaywallUpgrade ?? goCheckout

  switch (view) {
    case 'checkout':
      return (
        <CheckoutView
          productRef={productRef}
          publishableKey={stripePublishableKey}
          returnUrl={returnUrl}
          classNames={classNames}
          fromPaywall={fromPaywall}
          paywallKind={paywall?.kind}
          plans={bootstrap.plans}
          onRequestTopup={goTopup}
          onRefreshBootstrap={onRefreshBootstrap}
          onClose={onClose}
        />
      )
    case 'account':
      return (
        <AccountView
          classNames={classNames}
          onTopup={goTopup}
          onChangePlan={changePlan}
          hideDetailCards={suppressDetailCards}
        />
      )
    case 'topup':
      return (
        <TopupView
          publishableKey={stripePublishableKey}
          returnUrl={returnUrl}
          classNames={classNames}
          onBack={goAccount}
        />
      )
    case 'paywall': {
      if (!paywall) return null
      const upgradeCandidate = findRecurringPlan(bootstrap.plans)
      const upgradeCta =
        upgradeCandidate && paywallUpgrade
          ? { label: formatUpgradeLabel(upgradeCandidate), onClick: paywallUpgrade }
          : undefined
      return (
        <PaywallView
          content={paywall}
          publishableKey={stripePublishableKey}
          returnUrl={returnUrl}
          classNames={classNames}
          upgradeCta={upgradeCta}
        />
      )
    }
    case 'nudge':
      return (
        <NudgeView
          bootstrap={bootstrap}
          onCta={nudgeCta}
          classNames={classNames}
        />
      )
    default:
      return null
  }
}

interface UpgradeCandidatePlan {
  reference?: string
  name?: string | null
  price?: number
  currency?: string
  planType?: string
  billingCycle?: string | null
  meterRef?: string | null
  limit?: number | null
}

function findRecurringPlan(plans: McpBootstrap['plans']): UpgradeCandidatePlan | null {
  const list = plans as unknown as UpgradeCandidatePlan[] | undefined
  if (!list || list.length === 0) return null
  const match = list.find((p) => {
    if (p.planType !== 'recurring') return false
    return !p.meterRef
  })
  return match ?? null
}

function formatUpgradeLabel(plan: UpgradeCandidatePlan): string {
  const name = plan.name ?? 'Unlimited'
  if (typeof plan.price === 'number' && plan.price > 0 && plan.currency) {
    const amount = Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: plan.currency.toUpperCase(),
      maximumFractionDigits: 0,
    }).format(plan.price / 100)
    const cycle = plan.billingCycle ? `/${plan.billingCycle.slice(0, 2)}` : ''
    return `Upgrade to ${name} — ${amount}${cycle}`
  }
  return `Upgrade to ${name}`
}
