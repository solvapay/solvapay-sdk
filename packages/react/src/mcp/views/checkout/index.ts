/**
 * Shared MCP checkout state machine. Used by both `McpCheckoutView`
 * (activate_plan) and `McpPaywallView` (paywall) so both surfaces
 * share the same plan → amount → payment → success flow.
 */

export { EmbeddedCheckout } from './EmbeddedCheckout'
export type { EmbeddedCheckoutProps } from './EmbeddedCheckout'
export { CheckoutStateMachine } from './CheckoutStateMachine'
export type { StateMachineProps } from './CheckoutStateMachine'
export type { BootstrapPlanLike, Cx, Step, SuccessMeta } from './shared'
export {
  isPayg,
  planSortByPaygFirstThenAsc,
  formatContinueLabel,
  formatPaygRate,
  inferIncludedCredits,
  shortCycle,
} from './shared'
