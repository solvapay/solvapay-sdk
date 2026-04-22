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
  SolvaPayMcpViewKind,
} from '@solvapay/mcp'
import { TOOL_FOR_VIEW, VIEW_FOR_TOOL } from '@solvapay/mcp'
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

interface CallToolResultLike {
  isError?: boolean
  structuredContent?: unknown
  content?: Array<{ type: string; text?: string }>
}

/**
 * Infer which `open_*` tool the host invoked so the client router knows
 * which view to mount. MCP Apps surface the launching tool via
 * `app.getHostContext()?.toolInfo?.tool.name`; falls back to `checkout`
 * when the context is unavailable (older hosts, direct resource opens).
 */
function inferViewFromHost(app: McpAppBootstrapLike): keyof typeof TOOL_FOR_VIEW {
  const name = app.getHostContext()?.toolInfo?.tool?.name
  if (name && VIEW_FOR_TOOL[name]) {
    const view = VIEW_FOR_TOOL[name]
    // Only dispatch views that still have a matching intent tool —
    // `paywall` is handled by the gate response, not a dedicated tool.
    if (view in TOOL_FOR_VIEW) {
      return view as keyof typeof TOOL_FOR_VIEW
    }
  }
  return 'checkout'
}

/**
 * Kick off the MCP session by calling the `open_*` tool that matches the
 * host's invocation context. Returns the bootstrap payload every view
 * needs (product ref, publishable key, return url) along with the view
 * discriminator so the top-level router can pick the right screen.
 */
export async function fetchMcpBootstrap(app: McpAppBootstrapLike): Promise<McpBootstrap> {
  const view = inferViewFromHost(app)
  const toolName = TOOL_FOR_VIEW[view]
  const result = (await app.callServerTool({
    name: toolName,
    arguments: {},
  })) as CallToolResultLike
  if (result.isError) {
    const first = result.content?.[0]
    const message =
      first && 'text' in first && typeof first.text === 'string'
        ? first.text
        : `${toolName} failed`
    throw new Error(message)
  }
  const structured = result.structuredContent as
    | (Partial<BootstrapPayload> & { view?: McpView; paywall?: unknown })
    | undefined
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
  const requestedView = structured?.view ?? view
  const paywall =
    requestedView === 'paywall' && isPaywallStructuredContent(structured?.paywall)
      ? structured.paywall
      : undefined
  // Paywall responses now carry the full bootstrap payload inline on
  // `structuredContent`, so `requestedView === 'paywall'` always comes
  // with `paywall` populated — no account-view fallback needed.
  const resolvedView: SolvaPayMcpViewKind = requestedView
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
  }
}

