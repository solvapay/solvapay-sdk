/**
 * Pure renewal helper decision/normalization cores (Step 29).
 *
 * Client calls, the 500ms settle delay, `instanceof SolvaPayError`, and
 * `handleRouteError` stay in `@solvapay/server` helpers.
 */

export type RenewalHelperError = {
  error: string
  status: number
  details?: string
}

const PURCHASE_REF_REQUIRED: RenewalHelperError = {
  error: 'Missing required parameter: purchaseRef is required',
  status: 400,
}

/**
 * Validate purchaseRef (JS truthiness: empty string fails).
 * Returns `null` when purchaseRef is present and non-empty.
 */
export function validatePurchaseRef(
  purchaseRef: string | null | undefined,
): RenewalHelperError | null {
  if (!purchaseRef) {
    return { ...PURCHASE_REF_REQUIRED }
  }
  return null
}

type PurchaseLike = Record<string, unknown>

function isObject(value: unknown): value is PurchaseLike {
  return typeof value === 'object' && value !== null
}

function unwrapPurchase(response: unknown): PurchaseLike | null {
  if (!isObject(response)) {
    return null
  }
  const nested = response.purchase
  if (isObject(nested)) {
    return nested
  }
  return response
}

/**
 * Normalize a cancel-purchase API response.
 *
 * Unwraps nested `.purchase`, requires truthy `reference`, and requires
 * `status === 'cancelled'` or truthy `cancelledAt`.
 */
export function normalizeCancelResponse(
  response: unknown,
): PurchaseLike | RenewalHelperError {
  const purchase = unwrapPurchase(response)
  if (!purchase) {
    return {
      error: 'Invalid response from cancel purchase endpoint',
      status: 500,
    }
  }

  if (!purchase.reference) {
    return {
      error: 'Cancel purchase response missing required fields',
      status: 500,
    }
  }

  const isCancelled = purchase.status === 'cancelled' || Boolean(purchase.cancelledAt)
  if (!isCancelled) {
    return {
      error: `Purchase cancellation failed: backend returned status '${String(purchase.status)}' without cancelledAt timestamp`,
      status: 500,
    }
  }

  return purchase
}

/**
 * Normalize a reactivate-purchase API response.
 *
 * Unwraps nested `.purchase`, requires truthy `reference`, and rejects
 * truthy `cancelledAt`.
 */
export function normalizeReactivateResponse(
  response: unknown,
): PurchaseLike | RenewalHelperError {
  const purchase = unwrapPurchase(response)
  if (!purchase) {
    return {
      error: 'Invalid response from reactivate purchase endpoint',
      status: 500,
    }
  }

  if (!purchase.reference) {
    return {
      error: 'Reactivate purchase response missing required fields',
      status: 500,
    }
  }

  if (purchase.cancelledAt) {
    return {
      error: 'Purchase reactivation failed: cancelledAt is still set',
      status: 500,
    }
  }

  return purchase
}

function isRenewalHelperError(
  value: PurchaseLike | RenewalHelperError,
): value is RenewalHelperError {
  return 'error' in value && 'status' in value && typeof value.status === 'number'
}

/**
 * Narrow normalize results for shim callers.
 */
export function isRenewalError(
  value: PurchaseLike | RenewalHelperError,
): value is RenewalHelperError {
  return isRenewalHelperError(value)
}

/**
 * Classify a cancel SolvaPayError message into a helper error (with details).
 */
export function classifyCancelError(message: string): RenewalHelperError {
  if (message.includes('not found')) {
    return {
      error: 'Purchase not found',
      status: 404,
      details: message,
    }
  }

  if (
    message.includes('cannot be cancelled') ||
    message.includes('does not belong to provider')
  ) {
    return {
      error: 'Purchase cannot be cancelled or does not belong to provider',
      status: 400,
      details: message,
    }
  }

  return {
    error: message,
    status: 500,
    details: message,
  }
}

/**
 * Classify a reactivate SolvaPayError message into a helper error (with details).
 */
export function classifyReactivateError(message: string): RenewalHelperError {
  if (message.includes('not found')) {
    return {
      error: 'Purchase not found',
      status: 404,
      details: message,
    }
  }

  if (
    message.includes('cannot be reactivated') ||
    message.includes('not pending cancellation') ||
    message.includes('already been fully cancelled') ||
    message.includes('already ended')
  ) {
    return {
      error: 'Purchase cannot be reactivated',
      status: 400,
      details: message,
    }
  }

  return {
    error: message,
    status: 500,
    details: message,
  }
}
