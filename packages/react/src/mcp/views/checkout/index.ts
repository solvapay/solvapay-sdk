/**
 * MCP checkout layout — the activation flow surfaced by
 * `<McpCheckoutView>`.
 *
 * State (step, transitions, success meta) lives in
 * `useCheckoutFlow` from `@solvapay/react`. This folder ships the
 * MCP-flavored layout: bridge wiring, "Stay on Free" affordance,
 * `solvapay-mcp-*` CSS hooks, and the per-step components.
 */

export { EmbeddedCheckout } from './EmbeddedCheckout'
export type { EmbeddedCheckoutProps } from './EmbeddedCheckout'
export type { BootstrapPlanLike, Cx, Step, SuccessMeta } from './shared'
export {
  isPayg,
  planSortByPaygFirstThenAsc,
  formatContinueLabel,
  formatPaygRate,
  inferIncludedCredits,
  shortCycle,
} from './shared'
