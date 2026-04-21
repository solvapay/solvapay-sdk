/**
 * Bootstrap + fetch-shim helpers for SolvaPay MCP Apps.
 *
 * `fetchMcpBootstrap(app)` — kicks off the MCP session by invoking the
 * `open_*` tool matching the host's invocation context and returns the
 * view discriminator + bootstrap payload every view needs.
 *
 * `createMcpFetch(transport)` — tunnels the handful of SDK HTTP calls that
 * still hit `/api/*` directly (mainly `usePlan` and `useCheckout`'s plan
 * resolver) through the transport so they work inside MCP host sandboxes
 * with no network egress.
 *
 * Both helpers moved out of the example `mcp-checkout-app/src/mcp-adapter.ts`
 * so any MCP App can use them verbatim.
 */

import type { SolvaPayMcpViewKind } from '@solvapay/mcp'
import { OPEN_TOOL_FOR_VIEW, VIEW_FOR_OPEN_TOOL } from '@solvapay/mcp'
import type { PaywallStructuredContent } from '@solvapay/server'
import { isPaywallStructuredContent } from '@solvapay/server'
import type { Plan } from '../types'
import type { SolvaPayTransport } from '../transport/types'
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
function inferViewFromHost(app: McpAppBootstrapLike): McpView {
  const name = app.getHostContext()?.toolInfo?.tool?.name
  if (name && VIEW_FOR_OPEN_TOOL[name]) return VIEW_FOR_OPEN_TOOL[name]
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
  const toolName = OPEN_TOOL_FOR_VIEW[view]
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
    | {
        view?: McpView
        productRef?: string
        stripePublishableKey?: string | null
        returnUrl?: string | null
        paywall?: unknown
      }
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
  const resolvedView = structured?.view ?? view
  const paywall =
    resolvedView === 'paywall' && isPaywallStructuredContent(structured?.paywall)
      ? structured.paywall
      : undefined
  if (resolvedView === 'paywall' && !paywall) {
    throw new Error(`${toolName} did not return a valid paywall content object`)
  }
  return {
    view: resolvedView,
    productRef: ref,
    stripePublishableKey: typeof key === 'string' && key ? key : null,
    returnUrl: raw,
    ...(paywall ? { paywall } : {}),
  }
}

/**
 * Minimal `Response` factory — `new Response(JSON.stringify(...))` works in
 * the browser but not in tests without DOM polyfills, so we keep the shape
 * narrow and only populate what the SDK consumers actually read.
 */
function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Fetch shim that intercepts the handful of SDK HTTP calls not yet routed
 * through the transport and tunnels them through the MCP adapter instead.
 *
 * Covers:
 *  - `GET /api/list-plans?productRef=…` → `transport.listPlans(productRef)`
 *  - `GET /api/get-product?productRef=…` → `transport.getProduct(productRef)`
 *  - `GET /api/merchant`                  → `transport.getMerchant()`
 *
 * Anything else is rejected — the MCP iframe has no network route to the
 * SolvaPay API, so an unmatched call would hang until CSP refuses it
 * anyway. Surfacing a dedicated error makes the mismatch obvious in dev
 * tools.
 */
export function createMcpFetch(transport: SolvaPayTransport): typeof fetch {
  return async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input instanceof Request
            ? input.url
            : String(input)

    const method = (init?.method || 'GET').toUpperCase()

    const parsed = new URL(url, 'http://mcp-checkout-app.local')
    const pathname = parsed.pathname

    try {
      if (method === 'GET' && pathname.endsWith('/api/list-plans')) {
        const productRef = parsed.searchParams.get('productRef') ?? ''
        if (!productRef) {
          return jsonResponse({ error: 'Missing required parameter: productRef' }, { status: 400 })
        }
        const plans: Plan[] = await transport.listPlans(productRef)
        return jsonResponse({ plans, productRef })
      }

      if (method === 'GET' && pathname.endsWith('/api/get-product')) {
        const productRef = parsed.searchParams.get('productRef') ?? ''
        if (!productRef) {
          return jsonResponse({ error: 'Missing required parameter: productRef' }, { status: 400 })
        }
        const product = await transport.getProduct(productRef)
        return jsonResponse(product)
      }

      if (method === 'GET' && pathname.endsWith('/api/merchant')) {
        const merchant = await transport.getMerchant()
        return jsonResponse(merchant)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'MCP fetch shim failed'
      return jsonResponse({ error: message }, { status: 500 })
    }

    return jsonResponse(
      {
        error: `Unrouted fetch inside MCP host: ${method} ${pathname}. Add a tool + adapter mapping or call the transport directly.`,
      },
      { status: 501 },
    )
  }
}
