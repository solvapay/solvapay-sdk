'use client'

/**
 * `<McpAppShell>` — thin in-iframe layout wrapping `<McpViewRouter>`.
 *
 * The shell is surface-routed, not tab-routed: `bootstrap.view` locks
 * the rendered surface for the invocation's lifetime.
 *
 * Surfaces rendered via `<McpViewRouter>`:
 *  - `checkout` — plan picker + activation dispatcher.
 *  - `account`  — current plan, balance, usage, payment method.
 *  - `topup`    — amount picker + Stripe.
 *
 * The legacy `'paywall'` / `'nudge'` surfaces were removed with the
 * text-only paywall refactor — merchant paywall / nudge responses are
 * plain narrations, not widget payloads. Legacy bootstrap
 * `view: 'about' | 'activate' | 'usage'` values still fall through to
 * the right surface: about/activate collapse into `checkout`, usage
 * into `account`.
 */

import React, { useEffect, useRef, useState } from 'react'
import { useMerchant } from '../hooks/useMerchant'
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
  McpTopupView,
  type McpTopupViewProps,
} from './views/McpTopupView'
import { resolveMcpClassNames, type McpViewClassNames } from './views/types'
import { ExternalLinkGlyph } from '../components/ExternalLinkGlyph'

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
 * the surviving three surfaces. Undefined bootstrap views default to
 * `account`.
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
  // In-session surface swaps (no host re-invocation): the customer
  // clicks "Change plan" on the account view, "Top up" on the
  // customer-details card, or "Back" on the topup view. The paywall /
  // nudge CTA flips were removed along with those surfaces.
  const [overrideView, setOverrideView] = useState<McpViewKind | null>(null)

  const resolvedView = resolveSurface(bootstrap.view)
  const effectiveView: McpViewKind = overrideView ?? resolvedView

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
  }, [onRefreshBootstrap, bootstrap.view])

  const showFooter = footer ?? Boolean(merchant?.termsUrl || merchant?.privacyUrl)
  // The sidebar (seller + customer details cards) shows only when
  // there's an authenticated customer to render details for.
  const isShellSidebarEligible = bootstrap.customer !== null

  // Product-driven title; the merchant/brand marker stays above it. The
  // MCP host chrome in some clients (Cursor) only prints the active
  // tool name above the iframe — no merchant logo — so re-painting the
  // identity inside the widget is the only reliable way to show it.
  // Hosts that do render a merchant icon (via `_meta.ui.icons` or
  // spec-level `icons[]`) now effectively get a second, larger mark;
  // that's a deliberate trade-off to avoid anonymous widgets on hosts
  // that don't.
  const productName =
    (bootstrap.product as { name?: string } | undefined)?.name ?? null
  const productDescription =
    (bootstrap.product as { description?: string } | undefined)?.description ?? null

  return (
    <div className="solvapay-mcp-shell">
      <ShellHeader
        merchant={merchant}
        productName={productName}
        productDescription={productDescription}
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
            onSurfaceChange={setOverrideView}
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

      {showFooter ? <ShellFooter classNames={classNames} merchant={merchant} /> : null}
    </div>
  )
}

function ShellHeader({
  merchant,
  productName,
  productDescription,
  classNames,
}: {
  merchant: ReturnType<typeof useMerchant>['merchant']
  productName: string | null
  productDescription: string | null
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

  const headingText = productName ?? displayName ?? 'My account'
  // Only show the description when we actually resolved a product
  // heading — falling back to the merchant name and then tacking on
  // a product description that belongs to a different title would
  // mislead, so the tagline is tied to the product identity it
  // describes.
  const tagline =
    productName && productDescription ? productDescription.trim() : null

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
      {tagline ? (
        <p className="solvapay-mcp-shell-tagline">{tagline}</p>
      ) : null}
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
          <ExternalLinkGlyph />
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
          <ExternalLinkGlyph />
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
   * Called when a surface asks to swap to another surface in-session
   * (account → topup via the details card, account → checkout via
   * "Change plan", topup → account via "Back"). The shell wires this
   * to its `overrideView` state.
   */
  onSurfaceChange?: (next: McpViewKind) => void
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
  onSurfaceChange,
  onRefreshBootstrap,
  onClose,
}: McpViewRouterProps): React.ReactNode {
  const { productRef, stripePublishableKey, returnUrl } = bootstrap
  const CheckoutView = (views?.checkout ?? McpCheckoutView) as React.ComponentType<McpCheckoutViewProps>
  const AccountView = (views?.account ?? McpAccountView) as React.ComponentType<McpAccountViewProps>
  const TopupView = (views?.topup ?? McpTopupView) as React.ComponentType<McpTopupViewProps>

  const goCheckout = onSurfaceChange ? () => onSurfaceChange('checkout') : undefined
  const goTopup = onSurfaceChange ? () => onSurfaceChange('topup') : undefined
  const goAccount = onSurfaceChange ? () => onSurfaceChange('account') : undefined

  switch (view) {
    case 'checkout':
      return (
        <CheckoutView
          productRef={productRef}
          publishableKey={stripePublishableKey}
          returnUrl={returnUrl}
          classNames={classNames}
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
          onChangePlan={goCheckout}
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
    default:
      return null
  }
}
