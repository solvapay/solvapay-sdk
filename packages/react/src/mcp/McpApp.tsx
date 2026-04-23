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
import type { SolvaPayMcpViewKind } from '@solvapay/mcp'
import { VIEW_FOR_TOOL } from '@solvapay/mcp'
import { McpBridgeProvider, type McpBridgeAppLike, type McpMessageOnSuccess } from './bridge'
import { createMcpAppAdapter, type McpAppLike } from './adapter'
import {
  classifyHostEntry,
  fetchMcpBootstrap,
  isTransportToolName,
  parseBootstrapFromToolResult,
  type CallToolResultLike,
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
export interface McpAppFull extends McpAppBootstrapLike, McpAppLike, McpBridgeAppLike {
  connect: () => Promise<void>
  // Real `App` uses `((ctx: McpUiHostContext) => void) | undefined` here;
  // we keep the type intentionally loose so callers don't fight variance.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onhostcontextchanged?: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onteardown?: any
  /**
   * Composable event subscription exposed by
   * `@modelcontextprotocol/ext-apps` `App` (via `ProtocolWithEvents`).
   * `<McpApp>` uses this to subscribe to `toolresult` so it can re-route
   * when the host re-invokes an intent tool against a mounted widget.
   * Kept optional so minimal test adapters can omit it — the code falls
   * back to the legacy `ontoolresult` setter.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addEventListener?: (evt: string, handler: (params: any) => void) => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  removeEventListener?: (evt: string, handler: (params: any) => void) => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ontoolresult?: any
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
  /**
   * Phase 5 — override the user-visible follow-up copy posted to the
   * chat after a committed success (topup completed, plan activated).
   * Return `null` to suppress a specific event; omit the prop entirely
   * to use the SDK defaults. Hosts that don't support `ui/message`
   * silently no-op regardless.
   */
  messageOnSuccess?: McpMessageOnSuccess
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

/**
 * Shape of the `ui/notifications/tool-result` params we care about.
 * Intentionally loose — the real `McpUiToolResultNotification['params']`
 * is structurally compatible.
 */
interface ToolResultNotificationParams {
  isError?: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content?: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  structuredContent?: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _meta?: any
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
  messageOnSuccess,
}: McpAppProps) {
  const cx = resolveMcpClassNames(classNames)
  const [bootstrap, setBootstrap] = useState<McpBootstrap | null>(null)
  const [initError, setInitError] = useState<string | null>(null)
  // Counter tracking client-initiated bootstrap fetches (mount +
  // `refreshBootstrap`). The tool-result subscription consults it so
  // it doesn't double-apply the same payload a fetch is about to
  // deliver via its own `setBootstrap`.
  const pendingBootstrapFetchRef = useRef(0)

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

    // Deferred promise resolved by the first non-error, non-transport
    // `toolresult` notification. The data-tool mount path awaits this
    // instead of re-calling the merchant tool (which would consume
    // another unit of usage). Intent-tool / fallback paths race it
    // too — whichever settles first wins.
    let resolveFirstNotification: (() => void) | undefined
    const firstNotificationApplied = new Promise<void>((r) => {
      resolveFirstNotification = r
    })

    // Subscribe to `ui/notifications/tool-result` for two purposes:
    //
    //  1. Phase 3 — re-route when the host re-invokes an intent tool
    //     against the already-mounted widget (no iframe remount).
    //  2. Data-tool iframe entry — when the host opens the widget
    //     because a paywalled merchant tool (e.g. `search_knowledge`)
    //     returned `_meta.ui.resourceUri`, the widget consumes the
    //     original tool result here rather than re-fetching an intent
    //     tool.
    //
    // Transport tool results (`create_payment_intent`, `process_payment`,
    // `activate_plan`, …) are awaited via the `callServerTool` adapter
    // promise already; re-applying them to `bootstrap` would double-apply
    // state.
    const onToolResult = (params: ToolResultNotificationParams) => {
      if (cancelled) return
      const toolName = app.getHostContext?.()?.toolInfo?.tool?.name ?? null
      if (toolName && isTransportToolName(toolName)) return
      // Dedupe: skip notifications that land during an in-flight
      // client-initiated bootstrap fetch — the fetch's own `setBootstrap`
      // already applies the same structuredContent. We still resolve
      // `firstNotificationApplied` so the data-tool wait path sees the
      // notification even when it's for an intent-tool echo.
      if (pendingBootstrapFetchRef.current) {
        resolveFirstNotification?.()
        return
      }
      try {
        // Route on `structuredContent.view` (set by the server's
        // `buildPayableHandler` / bootstrap builders). Tool name only
        // matters as a fallback when the server omitted `view` — which
        // shouldn't happen, but keeps the parse robust. `paywall` is the
        // sensible default for data-tool entries (they're gate/nudge by
        // construction).
        //
        // `parseBootstrapFromToolResult` handles the paywall's
        // `isError: true` semantic by recognising the embedded
        // `BootstrapPayload` shape; genuine errors (no structured
        // content) throw and are swallowed below.
        const intentView = toolName ? VIEW_FOR_TOOL[toolName] : undefined
        const fallbackView: SolvaPayMcpViewKind = intentView ?? 'paywall'
        const fresh = parseBootstrapFromToolResult(
          params as unknown as CallToolResultLike,
          toolName ?? '(unknown tool)',
          fallbackView,
        )
        setBootstrap(fresh)
        resolveFirstNotification?.()
      } catch (err) {
        // A malformed notification shouldn't clobber the mounted shell;
        // surface it as a soft warning and keep the last-good bootstrap.
        if (typeof console !== 'undefined') {
          console.warn('[solvapay] ignoring malformed tool-result notification:', err)
        }
      }
    }

    let unsubscribe: (() => void) | undefined
    if (typeof app.addEventListener === 'function') {
      app.addEventListener('toolresult', onToolResult)
      unsubscribe = () => {
        app.removeEventListener?.('toolresult', onToolResult)
      }
    } else {
      // Fallback for hosts / mocks exposing only the legacy DOM-style
      // setter. We save the prior handler and restore on cleanup to
      // avoid clobbering an outer composition.
      const prior = app.ontoolresult
      app.ontoolresult = onToolResult
      unsubscribe = () => {
        if (app.ontoolresult === onToolResult) app.ontoolresult = prior
      }
    }

    ;(async () => {
      try {
        await app.connect()
        if (cancelled) return
        applyContextRef.current?.(app.getHostContext())

        const classification = classifyHostEntry(app)

        if (classification.kind === 'data') {
          // Data-tool entry: the host opened the iframe from a
          // paywalled merchant tool result. Wait for the original
          // tool-result payload instead of calling a new tool.
          const timeoutMs = 2000
          const timedOut = await Promise.race([
            firstNotificationApplied.then(() => false as const),
            new Promise<true>((r) => setTimeout(() => r(true), timeoutMs)),
          ])
          if (cancelled) return
          if (timedOut) {
            throw new Error(
              `The host opened the SolvaPay widget from a '${classification.toolName}' tool result, ` +
                `but no \`ui/notifications/tool-result\` arrived within ${timeoutMs}ms. ` +
                `Check that the MCP host forwards the originating tool result to the mounted iframe.`,
            )
          }
          // The notification handler has already applied the bootstrap.
          return
        }

        // Intent tool or fallback (unknown / transport entry): call
        // the matching intent tool via `fetchMcpBootstrap`. The
        // `pendingBootstrapFetchRef` gate suppresses the echo
        // notification while this in-flight fetch applies state.
        pendingBootstrapFetchRef.current += 1
        try {
          const result = await fetchMcpBootstrap(app)
          if (!cancelled) setBootstrap(result)
        } finally {
          pendingBootstrapFetchRef.current = Math.max(
            0,
            pendingBootstrapFetchRef.current - 1,
          )
        }
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : 'Failed to initialize SolvaPay'
        setInitError(message)
        onInitErrorRef.current?.(err instanceof Error ? err : new Error(message))
      }
    })()

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [app])

  const transport = useMemo(() => createMcpAppAdapter(app), [app])

  const initial: SolvaPayProviderInitial | undefined = useMemo(
    () => (bootstrap ? bootstrapToInitial(bootstrap) : undefined),
    [bootstrap],
  )

  // Surface the merchant's square icon (or landscape logo as fallback)
  // as the iframe's `<link rel="icon">`. Some MCP hosts pick the iframe
  // favicon up for their chrome strip, and dev-mode browsers (MCP
  // Inspector, local HTML previews) show it in the tab — a low-effort
  // secondary channel that complements the `tool.icons` advertisement
  // already wired through `createSolvaPayMcpServer`. Runs in the
  // browser only; silent no-op under SSR.
  const iconUrl = bootstrap?.merchant
    ? ((bootstrap.merchant as { iconUrl?: string; logoUrl?: string }).iconUrl ??
      (bootstrap.merchant as { logoUrl?: string }).logoUrl ??
      null)
    : null
  useEffect(() => {
    if (typeof document === 'undefined') return
    if (!iconUrl) return
    const MANAGED_ATTR = 'data-solvapay-favicon'
    const existing = document.head.querySelector<HTMLLinkElement>(
      `link[${MANAGED_ATTR}]`,
    )
    const link = existing ?? document.createElement('link')
    link.setAttribute(MANAGED_ATTR, '')
    link.rel = 'icon'
    link.href = iconUrl
    if (!existing) document.head.appendChild(link)
    return () => {
      // Leave the tag in place across bootstrap updates so the tab
      // favicon doesn't flicker — the next render's effect will update
      // `href` in-place. Only clean up on unmount.
    }
  }, [iconUrl])

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
      pendingBootstrapFetchRef.current += 1
      try {
        const fresh = await fetchMcpBootstrap(app)
        const next = bootstrapToInitial(fresh)
        seedMcpCaches(next, providerConfig)
        setBootstrap(fresh)
      } finally {
        pendingBootstrapFetchRef.current = Math.max(0, pendingBootstrapFetchRef.current - 1)
      }
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
      <McpBridgeProvider app={app} messageOnSuccess={messageOnSuccess}>
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
      </McpBridgeProvider>
    </SolvaPayProvider>
  )
}

// Re-export `McpViewRouter` and its props type for advanced integrators
// that want dispatch without the full shell (merged from the removed
// duplicate router in this file).
export { McpViewRouter } from './McpAppShell'
export type { McpViewRouterProps } from './McpAppShell'
