/**
 * Product-ref shape checks and readiness evaluation.
 *
 * Logic lives in Rust (`product_readiness`); this module is the TypeScript
 * facade plus the scaffolder placeholder constant.
 */

import { dispatchSync } from './native-dispatch'

export const SOLVAPAY_PRODUCT_REF_PLACEHOLDER = '__SOLVAPAY_PRODUCT_REF__'

export type { ProductReadinessInput, ProductReadinessResult } from './types/boundary.generated'

import type { ProductReadinessInput, ProductReadinessResult } from './types/boundary.generated'

/**
 * Evaluate whether a product can be sold (active status plus an active plan).
 *
 * Typed facade over the native `evaluateProductReadiness` dispatch. The
 * scaffolder placeholder constant lives here because it is host-side, not core.
 */
export function evaluateProductReadiness(product: ProductReadinessInput): ProductReadinessResult {
  return dispatchSync('evaluateProductReadiness', product)
}

/**
 * Reject empty, placeholder, or non-prd_ product refs at construction time.
 *
 * Throws with a message that names `context` so construction-time failures
 * point at the call site.
 */
export function assertValidProductRef(productRef: string, context: string): void {
  dispatchSync('assertValidProductRef', { productRef, context })
}
