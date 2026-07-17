/**
 * Pure activation param validation (Step 26).
 *
 * Request/auth/HTTP stay in `@solvapay/server` helpers.
 */

export type ActivatePlanValidationError = {
  error: string
  status: number
}

const MISSING_PARAMS_ERROR: ActivatePlanValidationError = {
  error: 'Missing required parameters: productRef and planRef are required',
  status: 400,
}

/**
 * Validate activate-plan body refs (JS truthiness: empty string fails).
 * Returns `null` when both refs are present and non-empty.
 */
export function validateActivatePlanParams(
  productRef: string | null | undefined,
  planRef: string | null | undefined,
): ActivatePlanValidationError | null {
  if (!productRef || !planRef) {
    return { ...MISSING_PARAMS_ERROR }
  }
  return null
}
