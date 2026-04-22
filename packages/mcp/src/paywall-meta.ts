/**
 * Canonical paywall `_meta.ui` envelope used by every SolvaPay MCP
 * tool result. Centralising this shape means swapping the UI resource
 * URI is a one-line builder call at every call site.
 */

export interface PaywallUiMetaInput {
  /** UI resource URI the MCP host opens to render the paywall view. */
  resourceUri: string
}

export interface PaywallUiMeta {
  ui: {
    resourceUri: string
  }
  [key: string]: unknown
}

/**
 * Build the `_meta` envelope attached to paywall tool results. Consumed
 * by `paywallToolResult`, `buildPayableHandler`, and the descriptor
 * registration layer so the shape stays in lockstep.
 *
 * The bootstrap payload itself now travels on `structuredContent` — this
 * envelope only tells the host which UI resource to open.
 */
export function buildPaywallUiMeta(input: PaywallUiMetaInput): PaywallUiMeta {
  return {
    ui: {
      resourceUri: input.resourceUri,
    },
  }
}
