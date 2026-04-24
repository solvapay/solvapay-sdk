/**
 * MCP App adapter — produces a `SolvaPayTransport` that routes every call
 * through `app.callServerTool` instead of HTTP.
 *
 * Use with `SolvaPayProvider` when the React tree is hosted inside an
 * MCP App (where Stripe.js and direct HTTP to your backend are both
 * blocked by the host sandbox):
 *
 * ```tsx
 * import { App } from '@modelcontextprotocol/ext-apps'
 * import { SolvaPayProvider } from '@solvapay/react'
 * import { createMcpAppAdapter } from '@solvapay/react/mcp'
 *
 * const app = new App({ name: 'solvapay', version: '1.0.0' })
 * const transport = createMcpAppAdapter(app)
 *
 * <SolvaPayProvider config={{ transport }}>...</SolvaPayProvider>
 * ```
 *
 * The adapter is tool-name-based: unimplemented tools surface as errors from
 * the MCP server, which are re-thrown with the server's text payload as the
 * message. Call sites can feature-detect by catching and matching.
 */

import type { SolvaPayTransport } from '../transport/types'
import { MCP_TOOL_NAMES } from '@solvapay/mcp-core'

/**
 * Minimal shape of `@modelcontextprotocol/sdk` `CallToolResult` — kept here
 * so consumers don't need `@modelcontextprotocol/sdk` installed just to
 * satisfy TypeScript when they use the adapter.
 */
interface CallToolResultLike {
  isError?: boolean
  structuredContent?: unknown
  content?: Array<{ type: string; text?: string }>
}

/**
 * Minimal shape of `@modelcontextprotocol/ext-apps` `App` — see the package
 * docs for the full interface. We only depend on `callServerTool`, so any
 * object satisfying this shape works (easier to mock in tests).
 */
export interface McpAppLike {
  callServerTool: (input: {
    name: string
    arguments?: Record<string, unknown>
  }) => Promise<CallToolResultLike>
}

function unwrap<T>(result: CallToolResultLike): T {
  if (result.isError) {
    const first = result.content?.[0]
    const message =
      first && 'text' in first && typeof first.text === 'string' ? first.text : 'MCP tool failed'
    throw new Error(message)
  }
  if (result.structuredContent !== undefined) {
    return result.structuredContent as T
  }
  const first = result.content?.[0]
  if (first && 'text' in first && typeof first.text === 'string') {
    try {
      return JSON.parse(first.text) as T
    } catch {
      throw new Error('MCP tool returned no parseable content')
    }
  }
  throw new Error('MCP tool returned no parseable content')
}

function pickDefined(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) {
    if (v !== undefined) out[k] = v
  }
  return out
}

/**
 * Wrap an MCP App (or any object implementing `callServerTool`) as a
 * `SolvaPayTransport`. Every provider-level data-access call tunnels
 * through `app.callServerTool(toolName, args)`.
 */
export function createMcpAppAdapter(app: McpAppLike): SolvaPayTransport {
  const callTool = async <T>(name: string, args: Record<string, unknown> = {}): Promise<T> =>
    unwrap<T>(await app.callServerTool({ name, arguments: args }))

  // Read tools (check_purchase, get_merchant, get_product, list_plans,
  // get_payment_method, get_customer_balance, get_usage) are intentionally
  // omitted — their data is folded into the `BootstrapPayload` returned
  // by every intent tool and seeded into the provider's module-level
  // caches via `seedMcpCaches`, so the transport never has to fetch.
  return {
    createPayment: params => callTool(MCP_TOOL_NAMES.createPayment, pickDefined({ ...params })),

    processPayment: params => callTool(MCP_TOOL_NAMES.processPayment, pickDefined({ ...params })),

    createTopupPayment: params =>
      callTool(MCP_TOOL_NAMES.createTopupPayment, pickDefined({ ...params })),

    cancelRenewal: params => callTool(MCP_TOOL_NAMES.cancelRenewal, pickDefined({ ...params })),

    reactivateRenewal: params =>
      callTool(MCP_TOOL_NAMES.reactivateRenewal, pickDefined({ ...params })),

    activatePlan: params => callTool(MCP_TOOL_NAMES.activatePlan, pickDefined({ ...params })),

    createCheckoutSession: params =>
      callTool(MCP_TOOL_NAMES.createCheckoutSession, pickDefined({ ...(params ?? {}) })),

    createCustomerSession: () => callTool(MCP_TOOL_NAMES.createCustomerSession),
  }
}
