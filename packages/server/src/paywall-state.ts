/**
 * Paywall state engine — Node may delegate to `@solvapay/server-native`
 * (Step 37R-c); edge / `SOLVAPAY_IMPL=ts` keep the TypeScript body.
 */

export type { PaywallState } from './paywall-state-ts'
export {
  buildGateMessage,
  buildNudgeMessage,
  classifyPaywallState,
} from './native-decisions'
