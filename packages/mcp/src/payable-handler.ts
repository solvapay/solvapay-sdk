/**
 * `buildPayableHandler(solvaPay, ctx, handler)` — framework-neutral
 * wrapper that produces an MCP tool handler enforcing the SolvaPay
 * paywall and auto-attaching `_meta.ui` to paywall results.
 *
 * Every SolvaPay MCP adapter (`@solvapay/mcp-sdk`, future `mcp-lite` /
 * `fastmcp` adapters) wraps this in its framework-specific
 * `registerTool` / `registerAppTool` call.
 */

import type { SolvaPay } from '@solvapay/server'
import { isPaywallStructuredContent } from '@solvapay/server'
import { buildPaywallUiMeta } from './paywall-meta'
import type { McpToolExtra, PaywallToolResult, SolvaPayCallToolResult } from './types'

export interface BuildPayableHandlerContext {
  /** SolvaPay product ref the tool is protected against. */
  product: string
  /** UI resource URI the MCP host should open to render the paywall view. */
  resourceUri: string
  /**
   * Name of the bootstrap tool that renders the paywall. Defaults to
   * `'open_paywall'`.
   */
  paywallToolName?: string
  /**
   * Override customer-ref extraction. Defaults to the MCP adapter's
   * behavior (reads `extra.authInfo.extra.customer_ref`).
   */
  getCustomerRef?: (
    args: Record<string, unknown>,
    extra?: McpToolExtra,
  ) => string | Promise<string>
}

/**
 * Build a paywall-protected MCP tool handler. Returned function is a
 * `(args, extra) => Promise<SolvaPayCallToolResult>` that any MCP
 * adapter can register directly.
 *
 * The handler:
 *  1. Routes the call through `solvaPay.payable({ product }).mcp(handler)`.
 *  2. Detects paywall results via `isPaywallStructuredContent` and
 *     stamps `_meta.ui = { resourceUri, toolName }` so the host knows
 *     which UI + bootstrap tool to open.
 */
export function buildPayableHandler<TArgs extends Record<string, unknown>, TResult>(
  solvaPay: SolvaPay,
  ctx: BuildPayableHandlerContext,
  handler: (args: TArgs, extra?: McpToolExtra) => Promise<TResult>,
): (args: Record<string, unknown>, extra?: McpToolExtra) => Promise<SolvaPayCallToolResult> {
  const { product, resourceUri, paywallToolName, getCustomerRef } = ctx
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const protectedHandler = solvaPay.payable({ product, getCustomerRef }).mcp(handler as any)

  return async (
    args: Record<string, unknown>,
    extra?: McpToolExtra,
  ): Promise<SolvaPayCallToolResult> => {
    const result = (await protectedHandler(args, extra)) as PaywallToolResult | SolvaPayCallToolResult
    if (result.isError && isPaywallStructuredContent(result.structuredContent)) {
      const existingMeta =
        typeof (result as PaywallToolResult)._meta === 'object' &&
        (result as PaywallToolResult)._meta !== null
          ? ((result as PaywallToolResult)._meta as Record<string, unknown>)
          : {}
      return {
        ...(result as SolvaPayCallToolResult),
        _meta: {
          ...existingMeta,
          ...buildPaywallUiMeta({ resourceUri, toolName: paywallToolName }),
        },
      }
    }
    return result as SolvaPayCallToolResult
  }
}
