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

import type { BootstrapPayload, McpToolExtra } from './types'

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
  buildBootstrap?: (view: string, extra?: McpToolExtra) => Promise<BootstrapPayload>
  /** Forwarded for logging / telemetry; not consumed by the text path. */
  extra?: McpToolExtra
}
