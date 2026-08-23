/**
 * Paywall state engine — public re-export facade.
 *
 * The classifier + gate/nudge copy builders are Rust-only after Step 53;
 * they dispatch through `native-decisions` (napi on Node, WASM on edge).
 */

export type { PaywallState } from './types/paywall'
export { buildGateMessage, buildNudgeMessage, classifyPaywallState } from './native-decisions'
