import type { App } from '@modelcontextprotocol/ext-apps'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { CustomerPurchaseData, SolvaPayProviderProps } from '@solvapay/react'

/**
 * Wire a SolvaPayProvider against the MCP server via `app.callServerTool`.
 *
 * Stripe.js is blocked inside the MCP host sandbox, so this adapter no longer
 * proxies payment intents. It exposes:
 *   - `checkPurchase` as a SolvaPayProvider override so `usePurchase` /
 *     `usePurchaseStatus` work against the MCP `check_purchase` tool
 *   - `createCheckoutSession` / `createCustomerSession` URL fetchers the UI
 *     uses to populate `<a target="_blank">` hrefs before the user clicks
 */
export type McpAdapter = {
  checkPurchase: NonNullable<SolvaPayProviderProps['checkPurchase']>
  createCheckoutSession: (args?: {
    planRef?: string
    productRef?: string
  }) => Promise<{ checkoutUrl: string }>
  createCustomerSession: () => Promise<{ customerUrl: string }>
}

function unwrap<T>(result: CallToolResult): T {
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
      // Fall through to error below
    }
  }
  throw new Error('MCP tool returned no parseable content')
}

export function createMcpAdapter(app: App): McpAdapter {
  const callTool = async <T>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
    const started = performance.now()
    console.warn(`[mcp-checkout-ui] -> ${name}`, args)
    try {
      const result = await app.callServerTool({ name, arguments: args })
      const ms = Math.round(performance.now() - started)
      if (result.isError) {
        console.warn(`[mcp-checkout-ui] <- ${name} ERROR in ${ms}ms`, result)
      } else {
        console.warn(`[mcp-checkout-ui] <- ${name} ok in ${ms}ms`, result.structuredContent)
      }
      return unwrap<T>(result)
    } catch (err) {
      const ms = Math.round(performance.now() - started)
      console.error(`[mcp-checkout-ui] <- ${name} THREW in ${ms}ms`, err)
      throw err
    }
  }

  return {
    checkPurchase: async () => callTool<CustomerPurchaseData>('check_purchase'),
    createCheckoutSession: async (args = {}) => {
      const payload: Record<string, unknown> = {}
      if (args.planRef) payload.planRef = args.planRef
      if (args.productRef) payload.productRef = args.productRef
      return callTool<{ checkoutUrl: string }>('create_checkout_session', payload)
    },
    createCustomerSession: async () =>
      callTool<{ customerUrl: string }>('create_customer_session'),
  }
}
