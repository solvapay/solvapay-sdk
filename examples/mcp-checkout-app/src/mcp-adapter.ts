/**
 * Thin wrapper around `@solvapay/react/mcp` that adds the example-specific
 * `open_checkout` bootstrap call plus a `fetch` shim for the handful of
 * SDK hooks that still hit `/api/*` HTTP routes directly (they don't yet
 * consult the transport — mainly `usePlan` and `useCheckout`'s plan
 * resolver).
 *
 * Before the React SDK shipped a first-class `createMcpAppAdapter`, this
 * file owned the full transport surface — checking purchases, minting
 * hosted checkout/customer URLs, the `unwrap` helper, tool-name constants.
 * All of that is now re-exported from the SDK; this file only carries the
 * MCP-App-specific pieces (fetching the product ref on boot, the fetch
 * shim).
 */

import type { App } from '@modelcontextprotocol/ext-apps'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { SolvaPayTransport } from '@solvapay/react'
import { createMcpAppAdapter } from '@solvapay/react/mcp'

export { createMcpAppAdapter }

/**
 * Kick off the MCP session and return the product the host opened us for.
 * The SolvaPay backend knows this from the tool registration; the UI just
 * reads it so the correct plan is displayed.
 */
export async function fetchOpenCheckoutProductRef(
  app: App,
): Promise<{ productRef: string; stripePublishableKey: string | null }> {
  const result = await app.callServerTool({ name: 'open_checkout', arguments: {} })
  if ((result as CallToolResult).isError) {
    const first = (result as CallToolResult).content?.[0]
    const message =
      first && 'text' in first && typeof first.text === 'string'
        ? first.text
        : 'open_checkout failed'
    throw new Error(message)
  }
  const structured = (result as CallToolResult).structuredContent as
    | { productRef?: string; stripePublishableKey?: string | null }
    | undefined
  const ref = structured?.productRef
  if (!ref) throw new Error('Server did not return a productRef')
  const key = structured?.stripePublishableKey ?? null
  return { productRef: ref, stripePublishableKey: typeof key === 'string' && key ? key : null }
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
