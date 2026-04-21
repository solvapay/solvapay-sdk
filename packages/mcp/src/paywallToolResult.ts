/**
 * Helper for hand-rolled MCP tool handlers that still want to attach the
 * `_meta.ui` envelope to paywall results without adopting
 * `buildPayableHandler` / `registerPayableTool` wholesale.
 */

import type { PaywallError } from '@solvapay/server'
import { buildPaywallUiMeta } from './paywall-meta'
import type { PaywallToolResult } from './types'

export interface PaywallToolResultContext {
  /** UI resource URI the MCP host should open to render the paywall view. */
  resourceUri: string
  /**
   * Name of the bootstrap tool that renders the paywall (defaults to
   * `'open_paywall'`). Hosts read this to decide which `open_*` tool to
   * invoke after receiving the paywall result.
   */
  toolName?: string
}

/**
 * Convert a `PaywallError` into a `PaywallToolResult` with `_meta.ui`
 * attached so MCP hosts know which UI resource + tool to open.
 *
 * @example
 * ```ts
 * registerAppTool(server, 'create_video', schema, async (args, extra) => {
 *   try {
 *     return await solvaPay.payable({ product }).mcp(handler)(args, extra)
 *   } catch (err) {
 *     if (err instanceof PaywallError) {
 *       return paywallToolResult(err, { resourceUri: 'ui://my-app/mcp-app.html' })
 *     }
 *     throw err
 *   }
 * })
 * ```
 */
export function paywallToolResult(
  err: PaywallError,
  ctx: PaywallToolResultContext,
): PaywallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: err.message }],
    structuredContent: err.structuredContent as unknown as Record<string, unknown>,
    _meta: buildPaywallUiMeta({ resourceUri: ctx.resourceUri, toolName: ctx.toolName }),
  }
}
