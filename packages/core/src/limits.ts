/**
 * Pure limits helper decision cores (Step 30).
 *
 * Auth, `ensureCustomer`, and `apiClient.checkLimits` stay in `@solvapay/server`.
 */

export type LimitsHelperError = {
  error: string
  status: number
}

export type CheckLimitsParams = {
  productRef: string
  meterName: string
}

const PRODUCT_REF_MISSING: LimitsHelperError = {
  error: 'Missing required parameter: productRef',
  status: 400,
}

/**
 * Validate check-limits query params (JS truthiness: empty string fails).
 * Defaults `meterName` to `'requests'` when falsy.
 */
export function resolveCheckLimitsParams(
  productRef: string | null | undefined,
  meterName: string | null | undefined,
): CheckLimitsParams | LimitsHelperError {
  if (!productRef) {
    return { ...PRODUCT_REF_MISSING }
  }
  return {
    productRef,
    meterName: meterName || 'requests',
  }
}
