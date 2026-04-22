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
 *   5. mount `<McpAppShell>`, which routes `bootstrap.view` into the
 *      exported `<McpViewRouter>`.
 *
 * Integrators who want to own the `SolvaPayProvider` mount (e.g. to merge
 * copy bundles, layer additional context) can bypass `<McpApp>` and use
 * `<McpAppShell>` directly, or `<McpViewRouter>` + the per-view primitives
 * for fully custom layouts.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { SolvaPayProvider } from '../SolvaPayProvider'
import { createMcpAppAdapter, type McpAppLike } from './adapter'
import {
  fetchMcpBootstrap,
  type McpBootstrap,
  type McpAppBootstrapLike,
} from './bootstrap'
import { seedMcpCaches } from './cache-seed'
import { McpAppShell } from './McpAppShell'
import type { Merchant, Plan, Product, SolvaPayConfig, SolvaPayProviderInitial } from '../types'
import type { McpAccountViewProps } from './views/McpAccountView'
import type { McpCheckoutViewProps } from './views/McpCheckoutView'
import type { McpPaywallViewProps } from './views/McpPaywallView'
import type { McpTopupViewProps } from './views/McpTopupView'
import type { McpNudgeViewProps } from './views/McpNudgeView'
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
  /**
   * Fire-and-forget request asking the host to unmount the app. When
   * approved, the host sends `ui/resource-teardown` back via
   * `onteardown`. Exposed by the real `@modelcontextprotocol/ext-apps`
   * `App` class — kept optional in the structural type so tests and
   * minimal adapters don't have to stub it.
   */
  requestTeardown?: () => Promise<void> | void
}

export interface McpAppViewOverrides {
  checkout?: React.ComponentType<McpCheckoutViewProps>
  account?: React.ComponentType<McpAccountViewProps>
  topup?: React.ComponentType<McpTopupViewProps>
  paywall?: React.ComponentType<McpPaywallViewProps>
  nudge?: React.ComponentType<McpNudgeViewProps>
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
  /** Override the shell-level footer visibility heuristic. */
  footer?: boolean
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
  /**
   * Override for the shell's "close this app" handler. Defaults to
   * `() => app.requestTeardown()`, which asks the host to unmount the
   * iframe (see `@modelcontextprotocol/ext-apps` `App.requestTeardown`).
   * Used by the checkout view's `"Back to chat"` and `"Stay on Free"`
   * affordances; passing `undefined` hides those affordances.
   */
  onClose?: () => void
}

/**
 * Pure mapper from the wire `McpBootstrap` (what `fetchMcpBootstrap`
 * returns) to the provider-shaped `SolvaPayProviderInitial`. Hoisted
 * out of the component so the reference is stable across renders and
 * safe to close over from `useMemo` / `useCallback`.
 */
function bootstrapToInitial(bs: McpBootstrap): SolvaPayProviderInitial {
  return {
    customerRef: bs.customer?.ref ?? null,
    purchase: bs.customer?.purchase ?? null,
    paymentMethod: bs.customer?.paymentMethod ?? null,
    balance: bs.customer?.balance ?? null,
    usage: bs.customer?.usage ?? null,
    merchant: bs.merchant as unknown as Merchant,
    product: bs.product as unknown as Product,
    plans: bs.plans as unknown as Plan[],
  }
}

export function McpApp({
  app,
  productRef: productRefOverride,
  views,
  classNames,
  footer,
  onInitError,
  applyContext,
  onClose,
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

  const initial: SolvaPayProviderInitial | undefined = useMemo(
    () => (bootstrap ? bootstrapToInitial(bootstrap) : undefined),
    [bootstrap],
  )

  const providerConfig = useMemo(
    () => {
      // Build the resolved config first so every `seedMcpCaches` call
      // (first render + post-refresh) runs against the same object the
      // hooks later read via `configRef.current` — otherwise
      // `createTransportCacheKey` could in principle compute a
      // different key at refresh-time than at mount-time.
      const resolved: SolvaPayConfig = {
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
            getUserId: async () => initial?.customerRef ?? null,
          },
        },
        transport,
        initial,
        refreshInitial: async (): Promise<SolvaPayProviderInitial | null> => {
          // Re-fetch the bootstrap payload by replaying the host-invoked
          // intent tool (`fetchMcpBootstrap` infers it from host context —
          // defaulting to `upgrade` when none is present). Re-seeds the
          // module caches so every hook sees the refreshed snapshot.
          const fresh = await fetchMcpBootstrap(app)
          const next = bootstrapToInitial(fresh)
          seedMcpCaches(next, resolved)
          return next
        },
      }
      return resolved
    },
    [transport, initial, app],
  )

  // Seed the module-level hook caches synchronously during render,
  // before any child mounts. Children (`useMerchant` / `useProduct` /
  // `usePlans` / `usePaymentMethod`) read the caches in their
  // `useState` initializers, and React runs child effects *after*
  // children render — so deferring to `useEffect` would miss the
  // initial read. A ref guard keeps the seed a one-shot per
  // `initial` change even under strict-mode double rendering.
  const seededInitialRef = useRef<SolvaPayProviderInitial | null>(null)
  if (initial && seededInitialRef.current !== initial) {
    seedMcpCaches(initial, providerConfig)
    seededInitialRef.current = initial
  }

  // Kept above the conditional returns so hook order is stable across
  // loading → ready transitions. Besides re-seeding the module-level
  // hook caches, we must also update the `bootstrap` state because the
  // shell reads `bootstrap.view` + `bootstrap.customer` to pick the
  // surface and sidebar state: without `setBootstrap`, a refresh that
  // reveals new capabilities (e.g. a freshly-topped-up balance) would
  // leave the shell stale.
  const refreshBootstrap = useMemo(
    () => async () => {
      const fresh = await fetchMcpBootstrap(app)
      const next = bootstrapToInitial(fresh)
      seedMcpCaches(next, providerConfig)
      setBootstrap(fresh)
    },
    [app, providerConfig],
  )

  // Default `onClose` asks the host to unmount via
  // `app.requestTeardown()`. Kept pointer-stable so the shell doesn't
  // remount its dismiss handlers on every parent render. Declared
  // above the conditional returns so React sees the same hook order
  // across loading / ready transitions.
  const defaultOnClose = useMemo(
    () => () => {
      void Promise.resolve(app.requestTeardown?.()).catch(() => {
        /* best-effort — host may deny. */
      })
    },
    [app],
  )
  const effectiveOnClose = onClose ?? defaultOnClose

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

  const effectiveBootstrap = productRefOverride
    ? { ...bootstrap, productRef: productRefOverride }
    : bootstrap

  return (
    <SolvaPayProvider config={providerConfig}>
      <main className="solvapay-mcp-main">
        <McpAppShell
          bootstrap={effectiveBootstrap}
          views={views}
          classNames={classNames}
          {...(footer !== undefined ? { footer } : {})}
          onRefreshBootstrap={refreshBootstrap}
          onClose={effectiveOnClose}
        />
      </main>
    </SolvaPayProvider>
  )
}

// Re-export `McpViewRouter` and its props type for advanced integrators
// that want dispatch without the full shell (merged from the removed
// duplicate router in this file).
export { McpViewRouter } from './McpAppShell'
export type { McpViewRouterProps } from './McpAppShell'
