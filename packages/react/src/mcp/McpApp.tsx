'use client'

/**
 * `<McpApp app={app} />` — the turnkey SolvaPay MCP App shell.
 *
 * Encapsulates the full client-side bootstrap for an MCP App built on
 * `@modelcontextprotocol/ext-apps`:
 *   1. `app.connect()`
 *   2. apply host theme / fonts / style variables / safe-area insets
 *   3. `fetchMcpBootstrap(app)` → view + productRef + publishableKey + returnUrl
 *   4. mount `<SolvaPayProvider transport=createMcpAppAdapter(app)>`
 *   5. route `<McpViewRouter>` → `<McpCheckoutView>` / `<McpAccountView>` / …
 *
 * Integrators who want to own the `SolvaPayProvider` mount (e.g. to merge
 * copy bundles, layer additional context) can bypass `<McpApp>` and use
 * `<McpViewRouter>` + the per-view primitives directly.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { SolvaPayProvider } from '../SolvaPayProvider'
import { createMcpAppAdapter, type McpAppLike } from './adapter'
import {
  fetchMcpBootstrap,
  createMcpFetch,
  type McpBootstrap,
  type McpAppBootstrapLike,
} from './bootstrap'
import {
  McpAccountView,
  type McpAccountViewProps,
} from './views/McpAccountView'
import {
  McpActivateView,
  type McpActivateViewProps,
} from './views/McpActivateView'
import {
  McpCheckoutView,
  type McpCheckoutViewProps,
} from './views/McpCheckoutView'
import {
  McpTopupView,
  type McpTopupViewProps,
} from './views/McpTopupView'
import { resolveMcpClassNames, type McpViewClassNames } from './views/types'

/**
 * Minimal host-context shape `<McpApp>` reads. Kept loose so the real
 * `@modelcontextprotocol/ext-apps` `McpUiHostContext` is structurally
 * assignable; consumers pass the helpers from `ext-apps` via
 * `applyContext` instead of depending on this shape directly.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type McpUiHostContextLike = any

/**
 * Subset of `@modelcontextprotocol/ext-apps` `App` that `<McpApp>` needs.
 *
 * Declared loosely so the real `App` is structurally assignable without
 * forcing consumers to match our stricter internal typing. Any object
 * satisfying these call signatures works (handy for tests).
 */
export interface McpAppFull extends McpAppBootstrapLike, McpAppLike {
  connect: () => Promise<void>
  // Real `App` uses `((ctx: McpUiHostContext) => void) | undefined` here;
  // we keep the type intentionally loose so callers don't fight variance.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onhostcontextchanged?: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onteardown?: any
}

export interface McpAppViewOverrides {
  checkout?: React.ComponentType<McpCheckoutViewProps>
  account?: React.ComponentType<McpAccountViewProps>
  topup?: React.ComponentType<McpTopupViewProps>
  activate?: React.ComponentType<McpActivateViewProps>
}

export interface McpAppProps {
  app: McpAppFull
  /**
   * Optional override for the product ref returned by `fetchMcpBootstrap`.
   * Useful when the client knows which product to target before the
   * server bootstrap resolves — rarely needed.
   */
  productRef?: string
  /** Per-view component overrides, e.g. to replace just `account`. */
  views?: McpAppViewOverrides
  /** Per-slot className overrides — forwarded to every built-in view. */
  classNames?: McpViewClassNames
  /**
   * Called with the bootstrap error if `app.connect()` or the `open_*`
   * tool call fails. Consumers typically log it; the default UI already
   * renders a human-readable error card.
   */
  onInitError?: (err: Error) => void
  /**
   * Optional hook to apply host context updates (theme, fonts, safe-area
   * insets). Defaults to a no-op; pass the helpers from
   * `@modelcontextprotocol/ext-apps` when you want the turnkey behaviour.
   *
   * Kept as a prop instead of a hard import so the SDK doesn't depend on
   * `@modelcontextprotocol/ext-apps` — host-context primitives live there.
   */
  applyContext?: (ctx: McpUiHostContextLike | undefined) => void
}

export function McpApp({
  app,
  productRef: productRefOverride,
  views,
  classNames,
  onInitError,
  applyContext,
}: McpAppProps) {
  const cx = resolveMcpClassNames(classNames)
  const [bootstrap, setBootstrap] = useState<McpBootstrap | null>(null)
  const [initError, setInitError] = useState<string | null>(null)

  // Capture `applyContext` / `onInitError` in refs so the persistent
  // `onhostcontextchanged` handler and the bootstrap effect always see
  // the latest prop value. Without this, consumers passing inline arrows
  // would be pinned to the first render's closure for every subsequent
  // host theme/font update.
  const applyContextRef = useRef(applyContext)
  const onInitErrorRef = useRef(onInitError)
  useEffect(() => {
    applyContextRef.current = applyContext
  }, [applyContext])
  useEffect(() => {
    onInitErrorRef.current = onInitError
  }, [onInitError])

  useEffect(() => {
    let cancelled = false

    // Reset transient bootstrap state whenever `app` changes so a stale
    // error card from a prior failed attempt doesn't survive a successful
    // re-bootstrap against the new app.
    setInitError(null)
    setBootstrap(null)

    // `@modelcontextprotocol/ext-apps` `App` exposes lifecycle hooks as
    // property setters — mutating the `app` prop is intentional and part
    // of the documented integration contract. The react-hooks immutability
    // rule can't infer that distinction; disable at the mutation site.
    // eslint-disable-next-line react-hooks/immutability
    app.onhostcontextchanged = (ctx: McpUiHostContextLike) => {
      applyContextRef.current?.(ctx)
    }
    app.onteardown = async () => ({})

    ;(async () => {
      try {
        await app.connect()
        applyContextRef.current?.(app.getHostContext())
        const result = await fetchMcpBootstrap(app)
        if (!cancelled) setBootstrap(result)
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : 'Failed to initialize SolvaPay'
        setInitError(message)
        onInitErrorRef.current?.(err instanceof Error ? err : new Error(message))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [app])

  const transport = useMemo(() => createMcpAppAdapter(app), [app])
  const mcpFetch = useMemo(() => createMcpFetch(transport), [transport])

  const providerConfig = useMemo(
    () => ({
      // `SolvaPayProvider` short-circuits its fetch pipeline when there's
      // no auth token, which means our `checkPurchase` override would
      // never run. In the MCP App the real identity lives server-side on
      // the OAuth bridge's `customer_ref`, so we just need to tell the
      // provider "yes, you're authenticated". Returning a sentinel token
      // is enough to flip `isAuthenticated` true and unlock the refetch
      // path.
      auth: {
        adapter: {
          getToken: async () => 'mcp-session',
          getUserId: async () => null,
        },
      },
      transport,
      fetch: mcpFetch,
    }),
    [transport, mcpFetch],
  )

  if (initError) {
    return (
      <main className="solvapay-mcp-main">
        <div className={`${cx.card} ${cx.error}`.trim()}>
          <h2 className={cx.heading}>Unable to load SolvaPay</h2>
          <p>{initError}</p>
        </div>
      </main>
    )
  }

  if (!bootstrap) {
    return (
      <main className="solvapay-mcp-main">
        <div className={cx.card}>
          <p>Loading…</p>
        </div>
      </main>
    )
  }

  return (
    <SolvaPayProvider config={providerConfig}>
      <main className="solvapay-mcp-main">
        <McpViewRouter
          bootstrap={
            productRefOverride ? { ...bootstrap, productRef: productRefOverride } : bootstrap
          }
          views={views}
          classNames={classNames}
        />
      </main>
    </SolvaPayProvider>
  )
}

export interface McpViewRouterProps {
  bootstrap: McpBootstrap
  views?: McpAppViewOverrides
  classNames?: McpViewClassNames
}

/**
 * Dispatches on `bootstrap.view` to render the matching per-view primitive.
 *
 * Exported separately so integrators who want to own the
 * `<SolvaPayProvider>` mount (e.g. to merge copy bundles or compose
 * additional providers) can still get routing for free.
 */
export function McpViewRouter({ bootstrap, views, classNames }: McpViewRouterProps) {
  // Note: `classNames` is intentionally forwarded as-is to each view —
  // `resolveMcpClassNames` runs inside them, not here.
  const { view, productRef, stripePublishableKey, returnUrl } = bootstrap

  const headerTitle: Record<McpBootstrap['view'], string> = {
    checkout: 'SolvaPay',
    account: 'Your SolvaPay account',
    topup: 'Add SolvaPay credits',
    activate: 'Activate your plan',
  }

  const CheckoutView = views?.checkout ?? McpCheckoutView
  const AccountView = views?.account ?? McpAccountView
  const TopupView = views?.topup ?? McpTopupView
  const ActivateView = views?.activate ?? McpActivateView

  return (
    <>
      <header className="solvapay-mcp-header">
        <h1>{headerTitle[view]}</h1>
      </header>
      {view === 'checkout' && (
        <CheckoutView
          productRef={productRef}
          publishableKey={stripePublishableKey}
          returnUrl={returnUrl}
          classNames={classNames}
        />
      )}
      {view === 'account' && <AccountView classNames={classNames} />}
      {view === 'topup' && (
        <TopupView
          publishableKey={stripePublishableKey}
          returnUrl={returnUrl}
          classNames={classNames}
        />
      )}
      {view === 'activate' && (
        <ActivateView productRef={productRef} classNames={classNames} />
      )}
    </>
  )
}
