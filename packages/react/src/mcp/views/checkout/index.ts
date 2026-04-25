/**
 * Shared MCP checkout state machine powering `McpCheckoutView`
 * (plan → amount → payment → success). Previously also wrapped by
 * `McpPaywallView`, which was removed in the text-only paywall
 * refactor — the `fromPaywall` / `paywallKind` props on the state
 * machine are still honoured so custom integrators can reuse the
 * amber "Upgrade to continue" banner when they build their own
 * surface.
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
