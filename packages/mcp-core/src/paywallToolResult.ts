/**
 * Helper for hand-rolled MCP tool handlers that still want to attach the
 * `_meta.ui` envelope + a full `BootstrapPayload` to paywall results
 * without adopting `buildPayableHandler` / `registerPayableTool`
 * wholesale.
 */

import type { PaywallStructuredContent } from '@solvapay/server'
import { PaywallError } from '@solvapay/server'
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
 * Convert a paywall gate (either a `PaywallError` or the underlying
 * `PaywallStructuredContent` returned by `paywall.decide()`) into a
 * `PaywallToolResult` carrying a full `BootstrapPayload` (so the
 * React shell can render the paywall view immediately) and the
 * `_meta.ui` envelope telling the host which resource to open.
 *
 * Prefer the gate-first form when you already have a
 * `PaywallDecision` in hand:
 *
 * ```ts
 * const decision = await solvaPay.paywall.decide(args, { product })
 * if (decision.outcome === 'gate') {
 *   return paywallToolResult(decision.gate, {
 *     resourceUri: 'ui://my-app/mcp-app.html',
 *     buildBootstrap,
 *     extra,
 *   })
 * }
 * ```
 *
 * The legacy `PaywallError`-first form continues to work for custom
 * adapters that still `try/catch`:
 *
 * ```ts
 * try {
 *   return await solvaPay.payable({ product }).mcp(handler)(args, extra)
 * } catch (err) {
 *   if (err instanceof PaywallError) {
 *     return paywallToolResult(err, {
 *       resourceUri: 'ui://my-app/mcp-app.html',
 *       buildBootstrap,
 *       extra,
 *     })
 *   }
 *   throw err
 * }
 * ```
 */
export async function paywallToolResult(
  errOrGate: PaywallError | PaywallStructuredContent,
  ctx: PaywallToolResultContext,
): Promise<PaywallToolResult> {
  const paywallContent: PaywallStructuredContent =
    errOrGate instanceof PaywallError ? errOrGate.structuredContent : errOrGate
  const narrationText =
    errOrGate instanceof PaywallError ? errOrGate.message : paywallContent.message

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
    // Deliberately `false`: paywall is a user-actionable gate, not a
    // tool failure. Hosts short-circuit on `isError: true` and render
    // the error text instead of opening the UI resource advertised by
    // `_meta.ui`, which meant the paywall widget never appeared on
    // MCPJam / Claude Desktop / ChatGPT Apps. The `structuredContent`
    // and `content[0].text` still carry the gate reason so the LLM
    // can narrate it, while `_meta.ui` triggers the widget.
    isError: false,
    content: [{ type: 'text', text: narrationText }],
    structuredContent,
    _meta: buildPaywallUiMeta({ resourceUri: ctx.resourceUri }),
  }
}
