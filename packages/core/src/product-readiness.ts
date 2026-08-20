/**
 * Pure product-ref shape checks and readiness evaluation.
 *
 * No network, no client — shared by `@solvapay/server`'s opt-in verifier
 * and `solvapay doctor` so the "ready" rule has one definition.
 */

export const SOLVAPAY_PRODUCT_REF_PLACEHOLDER = '__SOLVAPAY_PRODUCT_REF__'

/** Product refs issued by the platform are `prd_`-prefixed. */
const PRODUCT_REF_SHAPE = /^prd_/

export type ProductReadinessInput = {
  status: string
  plans?: Array<{ isActive: boolean }>
}

export type ProductReadinessResult = {
  ready: boolean
  /** Human-readable reasons `ready` is false. Empty when ready. */
  issues: string[]
  activePlans: number
  totalPlans: number
}

/**
 * Whether a resolved product can be sold end-to-end: active status with
 * at least one active plan.
 */
export function evaluateProductReadiness(product: ProductReadinessInput): ProductReadinessResult {
  const plans = product.plans ?? []
  const activePlans = plans.filter(plan => plan.isActive).length
  const issues: string[] = []

  if (product.status !== 'active') {
    issues.push(`product status is "${product.status}"`)
  }
  if (activePlans === 0) {
    issues.push(
      plans.length === 0
        ? 'no plans defined — customers have nothing to purchase'
        : `none of its ${plans.length} plan(s) are active`,
    )
  }

  return {
    ready: issues.length === 0,
    issues,
    activePlans,
    totalPlans: plans.length,
  }
}

/**
 * Synchronous shape check for a product ref. Throws with a message that
 * names `context` (e.g. `buildSolvaPayDescriptors`) so construction-time
 * failures point at the call site.
 */
export function assertValidProductRef(productRef: string, context: string): void {
  const trimmed = productRef.trim()
  if (!trimmed) {
    throw new Error(`${context}: productRef is required (expected a prd_* reference).`)
  }
  if (trimmed === SOLVAPAY_PRODUCT_REF_PLACEHOLDER) {
    throw new Error(
      `${context}: productRef is still the scaffolder placeholder ` +
        `"${SOLVAPAY_PRODUCT_REF_PLACEHOLDER}". Run \`npx solvapay init\` ` +
        '(or `npx solvapay doctor`) to set a real product reference.',
    )
  }
  if (!PRODUCT_REF_SHAPE.test(trimmed)) {
    throw new Error(
      `${context}: productRef must look like "prd_…" (got "${trimmed}"). ` +
        'Copy the reference from SolvaPay Console → Products.',
    )
  }
}
