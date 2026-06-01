/**
 * Backwards-compatible re-exports for the MCP checkout's shared
 * helpers. The canonical home for these moved to
 * `packages/react/src/primitives/checkout/shared.ts` so the headless
 * `useCheckoutFlow` and the `<CheckoutSteps.*>` parts can consume
 * them without depending on `@solvapay/react/mcp`.
 *
 * Files inside `mcp/views/checkout/` keep importing from this module
 * to avoid touching every step file; net effect is the same set of
 * names, with one source of truth.
 */

import { resolveMcpClassNames } from '../types'

export type Cx = ReturnType<typeof resolveMcpClassNames>

export type {
  CheckoutStep as Step,
  BootstrapPlanLike,
  SuccessMeta,
} from '../../../primitives/checkout/shared'

export {
  isPayg,
  planSortByPaygFirstThenAsc,
  formatContinueLabel,
  formatPaygRate,
  inferIncludedCredits,
  shortCycle,
} from '../../../primitives/checkout/shared'
