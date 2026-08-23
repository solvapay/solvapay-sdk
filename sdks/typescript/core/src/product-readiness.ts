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
 * Whether a resolved product can be sold end-to-end: active status with
 * at least one active plan.
 */
export function evaluateProductReadiness(product: ProductReadinessInput): ProductReadinessResult {
  return dispatchSync('evaluateProductReadiness', product)
}

/**
 * Synchronous shape check for a product ref. Throws with a message that
 * names `context` so construction-time failures point at the call site.
 */
export function assertValidProductRef(productRef: string, context: string): void {
  dispatchSync('assertValidProductRef', { productRef, context })
}
