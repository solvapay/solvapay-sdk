/**
 * Pure product helper decision cores (Step 31).
 *
 * Config/capability guards and `apiClient.getProduct` stay in `@solvapay/server`.
 */

export type ProductHelperError = {
  error: string
  status: number
}

const PRODUCT_REF_MISSING: ProductHelperError = {
  error: 'Missing required parameter: productRef',
  status: 400,
}

/**
 * Validate get-product query productRef (JS truthiness: empty string fails).
 * Returns `null` when productRef is present and non-empty.
 */
export function validateGetProductParams(
  productRef: string | null | undefined,
): ProductHelperError | null {
  if (!productRef) {
    return { ...PRODUCT_REF_MISSING }
  }
  return null
}
