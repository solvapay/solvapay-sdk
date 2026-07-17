/**
 * Pure plans helper decision cores (Step 30).
 *
 * Config/capability guards and `apiClient.listPlans` stay in `@solvapay/server`.
 */

export type PlansHelperError = {
  error: string
  status: number
}

const PRODUCT_REF_MISSING: PlansHelperError = {
  error: 'Missing required parameter: productRef',
  status: 400,
}

/**
 * Validate list-plans query productRef (JS truthiness: empty string fails).
 * Returns `null` when productRef is present and non-empty.
 */
export function validateListPlansParams(
  productRef: string | null | undefined,
): PlansHelperError | null {
  if (!productRef) {
    return { ...PRODUCT_REF_MISSING }
  }
  return null
}
