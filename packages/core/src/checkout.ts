/**
 * Pure checkout helper decision/normalization cores (Step 27).
 *
 * Request URL origin parsing stays in `@solvapay/server` helpers; this module
 * takes the already-resolved origin string (or null on parse failure).
 */

export type CheckoutHelperError = {
  error: string
  status: number
}

const PRODUCT_REF_REQUIRED: CheckoutHelperError = {
  error: 'Missing required parameter: productRef is required',
  status: 400,
}

/**
 * Validate checkout-session body productRef (JS truthiness: empty string fails).
 * Returns `null` when productRef is present and non-empty.
 */
export function validateCheckoutSessionParams(
  productRef: string | null | undefined,
): CheckoutHelperError | null {
  if (!productRef) {
    return { ...PRODUCT_REF_REQUIRED }
  }
  return null
}

/**
 * Resolve returnUrl with JS-falsy precedence: body → options → origin → undefined.
 *
 * Empty strings are falsy and fall through. `origin` is the already-parsed
 * request origin (or null/undefined when URL parsing failed).
 */
export function resolveReturnUrl(
  bodyReturnUrl?: string | null,
  optionsReturnUrl?: string | null,
  origin?: string | null,
): string | undefined {
  const fromBodyOrOptions = bodyReturnUrl || optionsReturnUrl
  if (fromBodyOrOptions) {
    return fromBodyOrOptions
  }
  if (origin) {
    return origin
  }
  return undefined
}
