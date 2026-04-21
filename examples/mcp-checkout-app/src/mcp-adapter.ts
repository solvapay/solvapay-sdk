/**
 * Thin wrapper around `@solvapay/react/mcp` that adds the example-specific
 * `open_*` bootstrap call plus a `fetch` shim for the handful of SDK hooks
 * that still hit `/api/*` HTTP routes directly (they don't yet consult the
 * transport — mainly `usePlan` and `useCheckout`'s plan resolver).
 *
 * Before the React SDK shipped a first-class `createMcpAppAdapter`, this
 * file owned the full transport surface — checking purchases, minting
 * hosted checkout/customer URLs, the `unwrap` helper, tool-name constants.
 * All of that is now re-exported from the SDK; this file only carries the
 * MCP-App-specific pieces (bootstrapping the view, the fetch shim).
 */

import type { App } from '@modelcontextprotocol/ext-apps'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { SolvaPayTransport } from '@solvapay/react'
import { createMcpAppAdapter } from '@solvapay/react/mcp'

export { createMcpAppAdapter }

/**
 * View discriminators the server returns from `open_*` tools. Mirrors the
 * `BootstrapView` union in `server.ts`; kept local to avoid a cross-import
 * between the browser bundle and the Node server module.
 */
export type BootstrapView = 'checkout' | 'account' | 'topup' | 'activate'

export interface Bootstrap {
  view: BootstrapView
  productRef: string
  stripePublishableKey: string | null
  returnUrl: string
}

const OPEN_TOOL_FOR_VIEW: Record<BootstrapView, string> = {
  checkout: 'open_checkout',
  account: 'open_account',
  topup: 'open_topup',
  activate: 'open_plan_activation',
}

/**
 * Infer which `open_*` tool the host invoked so the client router knows
 * which view to mount. MCP Apps surface the launching tool via
 * `app.getHostContext()?.toolInfo?.tool.name`; we fall back to `checkout`
 * when the context is unavailable (older hosts, direct resource opens),
 * which matches the pre-router behaviour.
 */
function inferViewFromHost(app: App): BootstrapView {
  const name = app.getHostContext()?.toolInfo?.tool.name
  if (name === 'open_account') return 'account'
  if (name === 'open_topup') return 'topup'
  if (name === 'open_plan_activation') return 'activate'
  return 'checkout'
}

/**
 * Kick off the MCP session by calling the `open_*` tool that matches the
 * host's invocation context. Returns the bootstrap payload every view
 * needs (product ref, publishable key, return url) along with the view
 * discriminator so the top-level router can pick the right screen.
 *
 * The server returns the same bootstrap shape for every `open_*` tool,
 * but we still dispatch to the matching one so the MCP trace reflects
 * intent and so the server has a hook to diverge later (e.g. gating
 * `open_plan_activation` behind a usage-based product).
 */
export async function fetchBootstrap(app: App): Promise<Bootstrap> {
  const view = inferViewFromHost(app)
  const toolName = OPEN_TOOL_FOR_VIEW[view]
  const result = await app.callServerTool({ name: toolName, arguments: {} })
  if ((result as CallToolResult).isError) {
    const first = (result as CallToolResult).content?.[0]
    const message =
      first && 'text' in first && typeof first.text === 'string'
        ? first.text
        : `${toolName} failed`
    throw new Error(message)
  }
  const structured = (result as CallToolResult).structuredContent as
    | {
        view?: BootstrapView
        productRef?: string
        stripePublishableKey?: string | null
        returnUrl?: string | null
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
  return {
    view: structured?.view ?? view,
    productRef: ref,
    stripePublishableKey: typeof key === 'string' && key ? key : null,
    returnUrl: raw,
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

    // Parse relative URLs against a dummy origin so `URL` accepts them.
    const parsed = new URL(url, 'http://mcp-checkout-app.local')
    const pathname = parsed.pathname

    try {
      if (method === 'GET' && pathname.endsWith('/api/list-plans')) {
        const productRef = parsed.searchParams.get('productRef') ?? ''
        if (!productRef) {
          return jsonResponse({ error: 'Missing required parameter: productRef' }, { status: 400 })
        }
        const plans = await transport.listPlans(productRef)
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
