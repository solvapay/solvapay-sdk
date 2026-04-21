/**
 * Canonical paywall `_meta.ui` envelope used by every SolvaPay MCP
 * tool result. Centralising this shape means adding a new UI surface
 * (different resource URI, different bootstrap tool) is a one-line
 * builder call at every call site.
 */

/**
 * Default bootstrap tool name for paywall results — the UI receives a
 * `_meta.ui.toolName` pointing here so the host knows which `open_*`
 * tool to call to render the paywall view.
 */
export const PAYWALL_BOOTSTRAP_TOOL_NAME = 'open_paywall'

export interface PaywallUiMetaInput {
  /** UI resource URI the MCP host opens to render the paywall view. */
  resourceUri: string
  /** `open_*` tool name the host should invoke. Defaults to `open_paywall`. */
  toolName?: string
}

export interface PaywallUiMeta {
  ui: {
    resourceUri: string
    toolName: string
  }
  [key: string]: unknown
}

/**
 * Build the `_meta` envelope attached to paywall tool results. Consumed
 * by `paywallToolResult`, `buildPayableHandler`, and the descriptor
 * registration layer so the shape stays in lockstep.
 */
export function buildPaywallUiMeta(input: PaywallUiMetaInput): PaywallUiMeta {
  return {
    ui: {
      resourceUri: input.resourceUri,
      toolName: input.toolName ?? PAYWALL_BOOTSTRAP_TOOL_NAME,
    },
  }
}
