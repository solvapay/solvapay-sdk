/**
 * Bootstrap helper for SolvaPay MCP Apps.
 *
 * `fetchMcpBootstrap(app)` — kicks off the MCP session by invoking the
 * `open_*` tool matching the host's invocation context and returns the
 * view discriminator + bootstrap payload every view needs (merchant,
 * product, plans, and customer snapshot).
 */

import type {
  BootstrapCustomer,
  BootstrapMerchant,
  BootstrapPayload,
  BootstrapPlan,
  BootstrapProduct,
  NudgeSpec,
  SolvaPayMcpViewKind,
} from '@solvapay/mcp'
import { MCP_TOOL_NAMES, TOOL_FOR_VIEW, VIEW_FOR_TOOL } from '@solvapay/mcp'
import type { PaywallStructuredContent } from '@solvapay/server'
import { isPaywallStructuredContent } from '@solvapay/server'
import type { McpAppLike } from './adapter'

/**
 * @deprecated Use `SolvaPayMcpViewKind` from `@solvapay/mcp` directly.
 * Kept as a type alias so existing consumers don't break.
 */
export type McpView = SolvaPayMcpViewKind

/**
 * Bootstrap payload returned from `fetchMcpBootstrap`. Structurally
 * compatible with `BootstrapPayload` from `@solvapay/mcp` but narrows
 * `paywall` to the server-owned `PaywallStructuredContent` union so
 * the client-side views can discriminate on `kind`.
 */
export interface McpBootstrap {
  view: SolvaPayMcpViewKind
  productRef: string
  stripePublishableKey: string | null
  returnUrl: string
  /**
   * Set when the MCP host invokes `open_paywall` — the structured
   * content gets forwarded on the bootstrap payload so the client
   * doesn't have to re-fetch it. Only populated for `view: 'paywall'`.
   */
  paywall?: PaywallStructuredContent
  /**
   * Upsell strip spec attached when `view: 'nudge'`. `McpNudgeView`
   * renders `McpUpsellStrip` using this.
   */
  nudge?: NudgeSpec
  /**
   * Merchant tool result data embedded alongside a nudge so the shell
   * can preview it without a follow-up tool call. Only populated when
   * `view: 'nudge'`.
   */
  data?: unknown
  /** Product-scoped snapshot — always present. */
  merchant: BootstrapMerchant
  product: BootstrapProduct
  plans: BootstrapPlan[]
  /** Per-customer snapshot — null when the bootstrap call was unauthenticated. */
  customer: BootstrapCustomer | null
}

/**
 * Extended `McpAppLike` shape used by `fetchMcpBootstrap` — the base adapter
 * only needs `callServerTool`, but the bootstrap helper also reads the
 * host context to infer which `open_*` tool the host invoked.
 *
 * The return type is intentionally loose so the real
 * `@modelcontextprotocol/ext-apps` `McpUiHostContext` is structurally
 * assignable without forcing consumers into our narrower shape.
 */
export interface McpAppBootstrapLike extends McpAppLike {
  getHostContext: () => McpHostContextLike | undefined
}

/**
 * Structural shape of `McpUiHostContext` for the fields `fetchMcpBootstrap`
 * reads. Loose on purpose — we only need `toolInfo?.tool?.name`.
 */
export interface McpHostContextLike {
  toolInfo?: {
    tool?: { name?: string }
  }
  // Permit arbitrary additional fields from the real host context.
  [key: string]: unknown
}

export interface CallToolResultLike {
  isError?: boolean
  structuredContent?: unknown
  content?: Array<{ type: string; text?: string }>
}

/**
 * Names of the SolvaPay transport tools whose results resolve through
 * the adapter promise returned by `callServerTool(...)`. `ui/notifications/
 * tool-result` payloads for these tools are already awaited by the
 * caller, so `<McpApp>` ignores them to avoid double-applying state.
 *
 * Derived from `MCP_TOOL_NAMES` minus the intent tools in
 * `TOOL_FOR_VIEW`, so adding a new transport tool requires exactly one
 * edit (in `@solvapay/mcp/tool-names`).
 */
export const SOLVAPAY_TRANSPORT_TOOL_NAMES: ReadonlySet<string> = new Set(
  (Object.values(MCP_TOOL_NAMES) as string[]).filter(
    (name) => !(name in VIEW_FOR_TOOL),
  ),
)

/**
 * True when `name` is one of SolvaPay's transport tools (payments,
 * sessions, renewal, activation). `<McpApp>` uses this to gate its live
 * `toolresult` subscription — transport tool notifications are ignored
 * because the `callServerTool` adapter promise already carries the
 * authoritative result.
 */
export function isTransportToolName(name: string): boolean {
  return SOLVAPAY_TRANSPORT_TOOL_NAMES.has(name)
}

/**
 * Classification of the host-invoked tool that opened the widget iframe.
 * Drives `<McpApp>`'s mount branching:
 *
 *  - `intent`  — one of `upgrade` / `manage_account` / `topup`. Call
 *                the corresponding tool via `fetchMcpBootstrap`.
 *  - `data`    — a merchant-registered paywalled tool (e.g.
 *                `search_knowledge`). The host opened the widget from
 *                its paywall/nudge result; wait for the initial
 *                `ui/notifications/tool-result` instead of re-calling
 *                the tool (which would consume another unit).
 *  - `other`   — no tool info, or a SolvaPay transport tool as the
 *                iframe entry point (rare). Fall back to the `upgrade`
 *                intent tool for a fresh snapshot.
 */
export type HostEntryClassification =
  | { kind: 'intent'; toolName: string; view: keyof typeof TOOL_FOR_VIEW }
  | { kind: 'data'; toolName: string }
  | { kind: 'other'; toolName?: string }

/**
 * Classify the host-invoked tool that opened the iframe. Reads
 * `app.getHostContext()?.toolInfo?.tool?.name` and consults the
 * `VIEW_FOR_TOOL` / `SOLVAPAY_TRANSPORT_TOOL_NAMES` tables.
 *
 * Exported so integrators who own their `<McpApp>` mount (or who build
 * fully custom widgets) can branch the same way.
 */
export function classifyHostEntry(app: McpAppBootstrapLike): HostEntryClassification {
  const toolName = app.getHostContext()?.toolInfo?.tool?.name
  if (!toolName) return { kind: 'other' }
  const view = VIEW_FOR_TOOL[toolName]
  if (view && view in TOOL_FOR_VIEW) {
    return {
      kind: 'intent',
      toolName,
      view: view as keyof typeof TOOL_FOR_VIEW,
    }
  }
  if (isTransportToolName(toolName)) return { kind: 'other', toolName }
  return { kind: 'data', toolName }
}

/**
 * Infer which intent tool to call for a fresh bootstrap. Returns the
 * matching intent `view` when the host's launching tool is one of
 * `upgrade` / `manage_account` / `topup`, else `'checkout'` (re-fetches
 * via `upgrade`).
 *
 * Used by `fetchMcpBootstrap` for both the initial intent-tool mount
 * path and `refreshBootstrap`. For data-tool iframe entries,
 * `<McpApp>` skips `fetchMcpBootstrap` entirely and waits on the
 * initial tool-result notification — re-calling the paywalled merchant
 * tool would consume another unit of usage.
 */
function inferViewFromHost(app: McpAppBootstrapLike): keyof typeof TOOL_FOR_VIEW {
  const classification = classifyHostEntry(app)
  if (classification.kind === 'intent') return classification.view
  return 'checkout'
}

/**
 * Kick off the MCP session by calling the `open_*` tool that matches the
 * host's invocation context. Returns the bootstrap payload every view
 * needs (product ref, publishable key, return url) along with the view
 * discriminator so the top-level router can pick the right screen.
 *
 * Used for intent-tool iframe entries and for `refreshInitial` after a
 * committed action (purchase, topup, etc.). Data-tool iframe entries
 * (paywall/nudge) bypass this helper; `<McpApp>` consumes the initial
 * `ui/notifications/tool-result` directly via
 * `parseBootstrapFromToolResult` so the merchant tool is not re-called.
 */
export async function fetchMcpBootstrap(app: McpAppBootstrapLike): Promise<McpBootstrap> {
  const view = inferViewFromHost(app)
  const toolName = TOOL_FOR_VIEW[view]
  const result = (await app.callServerTool({
    name: toolName,
    arguments: {},
  })) as CallToolResultLike
  return parseBootstrapFromToolResult(result, toolName, view)
}

/**
 * Parse a raw `CallToolResult`-shaped payload into an `McpBootstrap`.
 *
 * Shared between `fetchMcpBootstrap` (client-initiated) and the live
 * `ui/notifications/tool-result` subscription (`<McpApp>` Phase 3).
 * Throws on missing product ref / invalid return URL so callers can
 * surface the error to `onInitError` instead of half-applying state.
 */
export function parseBootstrapFromToolResult(
  result: CallToolResultLike,
  toolName: string,
  fallbackView: SolvaPayMcpViewKind,
): McpBootstrap {
  const structured = result.structuredContent as
    | (Partial<BootstrapPayload> & { view?: McpView; paywall?: unknown })
    | undefined
  // Paywall + nudge responses ship with `isError: false` now —
  // `buildPayableHandler` deliberately clears the error flag so hosts
  // open the `_meta.ui` widget instead of short-circuiting on the
  // error path. The old behaviour (paywall + isError:true) is still
  // accepted here so older servers keep working; only treat `isError`
  // as a real failure when we can't recognise the embedded bootstrap.
  const hasBootstrapShape =
    structured !== undefined &&
    typeof structured === 'object' &&
    typeof structured.productRef === 'string'
  if (result.isError && !hasBootstrapShape) {
    const first = result.content?.[0]
    const message =
      first && 'text' in first && typeof first.text === 'string'
        ? first.text
        : `${toolName} failed`
    throw new Error(message)
  }
  const ref = structured?.productRef
  if (!ref) throw new Error(`${toolName} did not return a productRef`)
  // Stripe's confirmPayment validator requires `return_url` to be an http(s)
  // URL with an explicit scheme. Inside the MCP host iframe
  // `window.location.origin` is the literal string `"null"` (browsers
  // return "null" for non-standard schemes like `ui://`), which Stripe
  // rejects with "An explicit scheme (such as https) must be provided."
  // So we require the server to supply a concrete http(s) origin and fail
  // loudly if it doesn't — there's no safe fallback we can derive
  // client-side in this host.
  const raw = structured?.returnUrl
  if (typeof raw !== 'string' || !/^https?:\/\//i.test(raw)) {
    throw new Error(
      `${toolName} did not return a valid http(s) returnUrl. Set MCP_PUBLIC_BASE_URL on the MCP server.`,
    )
  }
  const key = structured?.stripePublishableKey ?? null
  const requestedView = structured?.view ?? fallbackView
  const paywall =
    requestedView === 'paywall' && isPaywallStructuredContent(structured?.paywall)
      ? structured.paywall
      : undefined
  const resolvedView: SolvaPayMcpViewKind = requestedView
  const nudgeSpec = (structured as { nudge?: unknown } | undefined)?.nudge
  const nudge =
    requestedView === 'nudge' && isNudgeSpec(nudgeSpec) ? (nudgeSpec as NudgeSpec) : undefined
  const data =
    requestedView === 'nudge'
      ? (structured as { data?: unknown } | undefined)?.data
      : undefined
  return {
    view: resolvedView,
    productRef: ref,
    stripePublishableKey: typeof key === 'string' && key ? key : null,
    returnUrl: raw,
    merchant: (structured?.merchant ?? {}) as BootstrapMerchant,
    product: (structured?.product ?? { reference: ref }) as BootstrapProduct,
    plans: Array.isArray(structured?.plans) ? (structured.plans as BootstrapPlan[]) : [],
    customer: (structured?.customer ?? null) as BootstrapCustomer | null,
    ...(paywall ? { paywall } : {}),
    ...(nudge ? { nudge } : {}),
    ...(data !== undefined ? { data } : {}),
  }
}

function isNudgeSpec(value: unknown): value is NudgeSpec {
  if (typeof value !== 'object' || value === null) return false
  const kind = (value as { kind?: unknown }).kind
  return (
    typeof kind === 'string' &&
    (kind === 'low-balance' || kind === 'cycle-ending' || kind === 'approaching-limit')
  )
}

/**
 * Shape of the `ui/notifications/tool-result` params we care about.
 * Loose on purpose — `McpUiToolResultNotification['params']` is
 * structurally compatible.
 */
interface ToolResultNotificationParams {
  isError?: boolean
  content?: Array<{ type: string; text?: string }>
  structuredContent?: unknown
  _meta?: unknown
}

type ToolResultListener = (params: ToolResultNotificationParams) => void

/**
 * Subset of `@modelcontextprotocol/ext-apps` `App` events that
 * `waitForInitialToolResult` subscribes to. Mirrors the contract in
 * `hooks/useMcpToolResult.ts` so either entry point works with
 * composable `addEventListener` hosts or legacy `ontoolresult` mocks.
 */
export interface AppToolResultEvents {
  addEventListener?: (evt: string, handler: ToolResultListener) => void
  removeEventListener?: (evt: string, handler: ToolResultListener) => void
  ontoolresult?: ToolResultListener | undefined
}

export interface WaitForInitialToolResultOptions {
  /**
   * How long to wait (ms) for the first non-error, non-transport
   * `toolresult` notification before giving up. Defaults to 2000ms —
   * the host is expected to fire the initial notification immediately
   * after `ui/initialize`, so 2s is a generous budget.
   */
  timeoutMs?: number
  /**
   * Optional signal to cancel the wait (e.g. component unmount). When
   * aborted, the returned promise resolves with `timedOut: true`.
   */
  signal?: AbortSignal
  /**
   * Fallback `view` passed to `parseBootstrapFromToolResult` when the
   * incoming payload doesn't carry a `structuredContent.view`. Defaults
   * to `'paywall'` since data-tool entries are paywall/nudge by
   * construction.
   */
  fallbackView?: SolvaPayMcpViewKind
}

export type WaitForInitialToolResultResult =
  | {
      timedOut: false
      bootstrap: McpBootstrap
      toolName: string | null
      params: ToolResultNotificationParams
    }
  | { timedOut: true; bootstrap: null; toolName: null; params: null }

/**
 * One-shot helper: subscribes to `toolresult`, resolves with the first
 * non-error, non-transport payload parsed into an `McpBootstrap`, and
 * unsubscribes.
 *
 * Intended for integrators who mount their own shell on top of
 * `createMcpAppAdapter` and need the same "consume the initial
 * tool-result payload" semantics `<McpApp>` uses internally. Subscribe
 * **before** calling `app.connect()` to avoid missing the initial
 * notification the host fires after `ui/initialize`.
 *
 * Parse errors are surfaced via the returned promise's rejection; a
 * timeout resolves with `timedOut: true` rather than throwing.
 */
export function waitForInitialToolResult(
  app: McpAppBootstrapLike & AppToolResultEvents,
  options: WaitForInitialToolResultOptions = {},
): Promise<WaitForInitialToolResultResult> {
  const { timeoutMs = 2000, signal, fallbackView = 'paywall' } = options

  return new Promise<WaitForInitialToolResultResult>((resolve, reject) => {
    let settled = false
    let cleanup: (() => void) | undefined

    // Forward-declared so `finish` can clear it; initialised below via
    // `setTimeout` once the subscription is wired up.
    let timer: ReturnType<typeof setTimeout> | null = null

    const finish = (outcome: WaitForInitialToolResultResult) => {
      if (settled) return
      settled = true
      if (timer !== null) clearTimeout(timer)
      cleanup?.()
      resolve(outcome)
    }

    const handler: ToolResultListener = (params) => {
      if (settled) return
      const toolName = app.getHostContext()?.toolInfo?.tool?.name ?? null
      if (toolName && isTransportToolName(toolName)) return
      try {
        // `parseBootstrapFromToolResult` accepts paywall responses
        // (`isError: true` + embedded `BootstrapPayload`) and only
        // throws for genuinely malformed/errored payloads.
        const bootstrap = parseBootstrapFromToolResult(
          params as unknown as CallToolResultLike,
          toolName ?? '(unknown)',
          fallbackView,
        )
        finish({ timedOut: false, bootstrap, toolName, params })
      } catch (err) {
        if (settled) return
        settled = true
        if (timer !== null) clearTimeout(timer)
        cleanup?.()
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    }

    if (typeof app.addEventListener === 'function') {
      app.addEventListener('toolresult', handler)
      cleanup = () => app.removeEventListener?.('toolresult', handler)
    } else {
      const prior = app.ontoolresult
      app.ontoolresult = handler
      cleanup = () => {
        if (app.ontoolresult === handler) app.ontoolresult = prior
      }
    }

    timer = setTimeout(() => {
      finish({ timedOut: true, bootstrap: null, toolName: null, params: null })
    }, timeoutMs)

    if (signal) {
      if (signal.aborted) {
        finish({ timedOut: true, bootstrap: null, toolName: null, params: null })
        return
      }
      signal.addEventListener(
        'abort',
        () => {
          finish({ timedOut: true, bootstrap: null, toolName: null, params: null })
        },
        { once: true },
      )
    }
  })
}

