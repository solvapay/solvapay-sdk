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
 * Identity is a single provenance line (`{merchant} · Paying as {email}`),
 * not a Seller / Your account sidebar. Fullscreen wraps the surface in
 * a 1000px hosted column; payment leads a summary rail, account trails
 * a context rail.
 *
 * The legacy `'paywall'` / `'nudge'` surfaces were removed with the
 * text-only paywall refactor — merchant paywall / nudge responses are
 * plain narrations, not widget payloads. Legacy bootstrap
 * `view: 'about' | 'activate' | 'usage'` values still fall through to
 * the right surface: about/activate collapse into `checkout`, usage
 * into `account`.
 */

import React, { useState } from 'react'
import type { McpBootstrap } from './bootstrap'
import type { McpAppViewOverrides } from './McpApp'
import type { McpViewKind } from './view-kind'
import { useCustomer } from '../hooks/useCustomer'
import { McpAccountView, type McpAccountViewProps } from './views/McpAccountView'
import { McpCheckoutView, type McpCheckoutViewProps } from './views/McpCheckoutView'
import { McpContextRail, McpHostedColumn, McpHostedLayout } from './views/McpHosted'
import { McpProvenanceLine } from './views/McpProvenanceLine'
import { McpTopupView, type McpTopupViewProps } from './views/McpTopupView'
import { resolveMcpClassNames, type McpViewClassNames } from './views/types'
import { LegalFooter } from '../primitives/LegalFooter'

// Merchant branding is rendered once by `<McpApp>` as a chrome row
// above the shell (see `packages/react/src/mcp/views/AppHeader.tsx`);
// hosts that paint their own chrome mark (ChatGPT, Claude Desktop)
// still suppress the in-widget strip via `AppHeader`'s `mode="auto"`
// host-name check.

export interface McpAppShellProps {
  bootstrap: McpBootstrap
  views?: McpAppViewOverrides
  classNames?: McpViewClassNames
  /** Render the SolvaPay legal footer? Defaults to `true`. */
  footer?: boolean
  /**
   * Refresh the bootstrap snapshot. Wired by `<McpApp>` to
   * `SolvaPayProvider.refreshInitial`. Passed through to views that
   * need an explicit post-commit refresh (e.g. after payment); the shell
   * does not invoke this on mount — the opening intent-tool result is
   * already authoritative and re-fetching would duplicate the server call.
   */
  onRefreshBootstrap?: () => void | Promise<void>
  /**
   * Ask the host to unmount the MCP app. Wired by `<McpApp>` to
   * `app.requestTeardown()`. The checkout view uses this for its
   * `"Stay on Free"` decline link on the plan-selection step.
   * `undefined` hides that affordance so integrators that own their
   * own mount can opt out.
   */
  onClose?: () => void
}

/**
 * Resolve the surface to render. The bootstrap's `view` is the source
 * of truth; legacy kinds (`about`, `activate`, `usage`) collapse into
 * the surviving three surfaces. Undefined bootstrap views default to
 * `account`.
 */
function resolveSurface(bootstrapView: McpBootstrap['view'] | string | undefined): McpViewKind {
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
  // In-session surface swaps (no host re-invocation): the customer
  // clicks "Change plan" on the account view, "Top up" on the credits
  // card, or "Back" on the topup view. The paywall / nudge CTA flips
  // were removed along with those surfaces.
  const [overrideView, setOverrideView] = useState<McpViewKind | null>(null)

  const resolvedView = resolveSurface(bootstrap.view)
  const effectiveView: McpViewKind = overrideView ?? resolvedView

  const showFooter = footer ?? true
  const surface = effectiveView === 'account' ? 'management' : 'payment'
  const provenance = bootstrap.customer ? (
    <ShellProvenance merchantName={bootstrap.merchant.displayName} />
  ) : null

  return (
    <div className="solvapay-mcp-shell">
      <McpHostedColumn surface={surface}>
        {surface === 'payment' ? provenance : null}
        <McpHostedLayout>
          <div className="solvapay-mcp-shell-body">
            <McpViewRouter
              view={effectiveView}
              bootstrap={bootstrap}
              views={views}
              classNames={classNames}
              onSurfaceChange={setOverrideView}
              onRefreshBootstrap={onRefreshBootstrap}
              onClose={onClose}
            />
          </div>
          {surface === 'management' && provenance ? (
            <McpContextRail>{provenance}</McpContextRail>
          ) : null}
        </McpHostedLayout>
      </McpHostedColumn>

      {showFooter ? <ShellFooter classNames={classNames} /> : null}
    </div>
  )
}

function ShellProvenance({ merchantName }: { merchantName: string | undefined }) {
  const { email } = useCustomer()
  return <McpProvenanceLine merchantName={merchantName} email={email} />
}

function ShellFooter({ classNames }: { classNames?: McpViewClassNames }) {
  const cx = resolveMcpClassNames(classNames)
  return (
    <footer className={`solvapay-mcp-shell-footer ${cx.muted}`.trim()}>
      <LegalFooter attribution="provided" />
    </footer>
  )
}

export interface McpViewRouterProps {
  /** Surface to render. */
  view: McpViewKind
  bootstrap: McpBootstrap
  views?: McpAppViewOverrides
  classNames?: McpViewClassNames
  /**
   * Called when a surface asks to swap to another surface in-session
   * (account → topup via the credits CTA, account → checkout via
   * "Change plan", topup → account via "Back"). The shell wires this
   * to its `overrideView` state.
   */
  onSurfaceChange?: (next: McpViewKind) => void
  /**
   * Optional bootstrap re-fetcher. The shell triggers it once on mount
   * so a customer who re-opens a backgrounded iframe sees fresh
   * caches; otherwise unused.
   */
  onRefreshBootstrap?: () => void | Promise<void>
  /**
   * Forwarded to `McpCheckoutView`'s `"Stay on Free"` decline link.
   * Wired by `<McpApp>` to `app.requestTeardown()`.
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
  onSurfaceChange,
  onRefreshBootstrap,
  onClose,
}: McpViewRouterProps): React.ReactNode {
  const { productRef, stripePublishableKey, returnUrl } = bootstrap
  const CheckoutView = (views?.checkout ??
    McpCheckoutView) as React.ComponentType<McpCheckoutViewProps>
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
          onBack={goAccount}
        />
      )
    case 'account':
      return (
        <AccountView
          classNames={classNames}
          onTopup={goTopup}
          onChangePlan={goCheckout}
          plans={bootstrap.plans}
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
