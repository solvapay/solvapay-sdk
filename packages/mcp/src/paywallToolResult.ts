/**
 * Helper for hand-rolled MCP tool handlers that still want to attach the
 * `_meta.ui` envelope + a full `BootstrapPayload` to paywall results
 * without adopting `buildPayableHandler` / `registerPayableTool`
 * wholesale.
 */

import type { PaywallError, PaywallStructuredContent } from '@solvapay/server'
import { buildPaywallUiMeta } from './paywall-meta'
import type {
  BootstrapPayload,
  McpToolExtra,
  PaywallToolResult,
} from './types'
import type { BuildBootstrapPayloadFn } from './bootstrap-payload'

export interface PaywallToolResultContext {
  /** UI resource URI the MCP host should open to render the paywall view. */
  resourceUri: string
  /**
   * Builds the full `BootstrapPayload` that rides on
   * `structuredContent` so the React shell can mount the paywall view
   * from the gate response directly — no follow-up `open_paywall` call.
   * Wire this from `buildSolvaPayDescriptors(...).buildBootstrapPayload`.
   */
  buildBootstrap?: BuildBootstrapPayloadFn
  /** Forwarded to `buildBootstrap` so customer-scoped fields resolve. */
  extra?: McpToolExtra
}

/**
 * Convert a `PaywallError` into a `PaywallToolResult` carrying a full
 * `BootstrapPayload` (so the React shell can render the paywall view
 * immediately) and the `_meta.ui` envelope telling the host which
 * resource to open.
 *
 * @example
 * ```ts
 * registerAppTool(server, 'create_video', schema, async (args, extra) => {
 *   try {
 *     return await solvaPay.payable({ product }).mcp(handler)(args, extra)
 *   } catch (err) {
 *     if (err instanceof PaywallError) {
 *       return paywallToolResult(err, {
 *         resourceUri: 'ui://my-app/mcp-app.html',
 *         buildBootstrap,
 *         extra,
 *       })
 *     }
 *     throw err
 *   }
 * })
 * ```
 */
export async function paywallToolResult(
  err: PaywallError,
  ctx: PaywallToolResultContext,
): Promise<PaywallToolResult> {
  const paywallContent = err.structuredContent as PaywallStructuredContent

  let structuredContent: Record<string, unknown>
  if (ctx.buildBootstrap) {
    const bootstrap: BootstrapPayload = await ctx.buildBootstrap('paywall', ctx.extra, {
      paywall: paywallContent,
    })
    structuredContent = bootstrap as unknown as Record<string, unknown>
  } else {
    structuredContent = paywallContent as unknown as Record<string, unknown>
  }

  return {
    isError: true,
    content: [{ type: 'text', text: err.message }],
    structuredContent,
    _meta: buildPaywallUiMeta({ resourceUri: ctx.resourceUri }),
  }
}
