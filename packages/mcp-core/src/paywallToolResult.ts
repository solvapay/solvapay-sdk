/**
 * Helper for hand-rolled MCP tool handlers that need to emit a
 * text-only paywall response without adopting `buildPayableHandler` /
 * `registerPayableTool` wholesale.
 *
 * The widget iframe is no longer opened for merchant payable data
 * tools (per SEP-1865 + the text-only paywall refactor), so this
 * helper ships a plain narration + `structuredContent = gate` pair.
 * The gate's `message` field — built by the
 * `classifyPaywallState` / `buildGateMessage` engine in
 * `@solvapay/server` — names the recovery intent tool and inlines
 * `checkoutUrl` for terminal-first hosts.
 */

import type { PaywallStructuredContent } from '@solvapay/server'
import { PaywallError } from '@solvapay/server'
import type { McpToolExtra, PaywallToolResult } from './types'
import type { BuildBootstrapPayloadFn } from './bootstrap-payload'

export interface PaywallToolResultContext {
  /**
   * Builds a full `BootstrapPayload`. Still accepted on the context
   * for intent-tool reuse, but NOT consumed here — the text-only
   * paywall ships the gate verbatim. Leaving the field on the type
   * preserves compatibility for callers that thread it through a
   * bound helper.
   *
   * @deprecated Not called by `paywallToolResult`. Will be removed in
   * a future major.
   */
  buildBootstrap?: BuildBootstrapPayloadFn
  /** Forwarded for logging / telemetry; not consumed by the text path. */
  extra?: McpToolExtra
}

/**
 * Convert a paywall gate (either a `PaywallError` or the underlying
 * `PaywallStructuredContent` returned by `paywall.decide()`) into a
 * text-only `PaywallToolResult`.
 *
 * ```ts
 * const decision = await solvaPay.paywall.decide(args, { product })
 * if (decision.outcome === 'gate') {
 *   return paywallToolResult(decision.gate)
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
 *   if (err instanceof PaywallError) return paywallToolResult(err)
 *   throw err
 * }
 * ```
 */
export async function paywallToolResult(
  errOrGate: PaywallError | PaywallStructuredContent,
  _ctx: PaywallToolResultContext = {},
): Promise<PaywallToolResult> {
  const paywallContent: PaywallStructuredContent =
    errOrGate instanceof PaywallError ? errOrGate.structuredContent : errOrGate
  const narrationText =
    errOrGate instanceof PaywallError ? errOrGate.message : paywallContent.message

  return {
    // Deliberately `false`: paywall is a user-actionable gate, not a
    // tool failure. The LLM narrates the recovery from
    // `content[0].text` and the structured gate content on
    // `structuredContent` is available for programmatic consumers.
    isError: false,
    content: [{ type: 'text', text: narrationText }],
    structuredContent: paywallContent as unknown as Record<string, unknown>,
  }
}
