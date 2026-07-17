/**
 * Pure payment helper decision/normalization cores (Step 27).
 *
 * Request parsing, customer sync, client calls, and balance polling stay in
 * `@solvapay/server` helpers.
 */

export type PaymentHelperError = {
  error: string
  status: number
}

export type PaymentIntentProjection = {
  processorPaymentId: string
  clientSecret: string
  publishableKey: string
  accountId?: string
  customerRef: string
}

export type PaymentIntentSource = {
  processorPaymentId: string
  clientSecret: string
  publishableKey: string
  accountId?: string
}

export type TopupProcessOutcome =
  | { status: 'timeout'; message?: string }
  | { status: 'failed' }
  | { status: 'cancelled' }
  | { status: 'succeeded' }

const CREATE_PI_MISSING: PaymentHelperError = {
  error: 'Missing required parameters: planRef and productRef are required',
  status: 400,
}

const TOPUP_AMOUNT_INVALID: PaymentHelperError = {
  error: 'Missing or invalid amount: must be a positive number',
  status: 400,
}

const TOPUP_CURRENCY_MISSING: PaymentHelperError = {
  error: 'Missing required parameter: currency',
  status: 400,
}

const PROCESS_PI_MISSING: PaymentHelperError = {
  error: 'paymentIntentId and productRef are required',
  status: 400,
}

const PAYMENT_INTENT_ID_REQUIRED: PaymentHelperError = {
  error: 'paymentIntentId is required',
  status: 400,
}

/**
 * Validate create-payment-intent body refs (JS truthiness: empty string fails).
 * Returns `null` when both refs are present and non-empty.
 */
export function validateCreatePaymentIntentParams(
  planRef: string | null | undefined,
  productRef: string | null | undefined,
): PaymentHelperError | null {
  if (!planRef || !productRef) {
    return { ...CREATE_PI_MISSING }
  }
  return null
}

/**
 * Validate top-up payment-intent params (ordered: amount → currency presence → case).
 * Returns `null` when amount is positive and currency is non-empty uppercase.
 */
export function validateTopupPaymentIntentParams(
  amount: number | null | undefined,
  currency: string | null | undefined,
): PaymentHelperError | null {
  if (!amount || amount <= 0) {
    return { ...TOPUP_AMOUNT_INVALID }
  }
  if (!currency) {
    return { ...TOPUP_CURRENCY_MISSING }
  }
  if (currency !== currency.toUpperCase()) {
    return {
      error: `Invalid currency "${currency}": must be an uppercase ISO 4217 code (e.g. "USD", "EUR")`,
      status: 400,
    }
  }
  return null
}

/**
 * Validate process-payment-intent body refs (JS truthiness).
 * Returns `null` when both are present and non-empty.
 */
export function validateProcessPaymentIntentParams(
  paymentIntentId: string | null | undefined,
  productRef: string | null | undefined,
): PaymentHelperError | null {
  if (!paymentIntentId || !productRef) {
    return { ...PROCESS_PI_MISSING }
  }
  return null
}

/**
 * Validate that `paymentIntentId` is present (attach-business-details / process-topup).
 * Returns `null` when the id is present and non-empty.
 */
export function validateAttachBusinessDetailsParams(
  paymentIntentId: string | null | undefined,
): PaymentHelperError | null {
  if (!paymentIntentId) {
    return { ...PAYMENT_INTENT_ID_REQUIRED }
  }
  return null
}

/**
 * Freeze the Zod-issue fallback used by attach-business-details.
 */
export function attachBusinessDetailsValidationError(
  firstIssueMessage?: string,
): PaymentHelperError {
  return {
    error: firstIssueMessage ?? 'Invalid business details',
    status: 400,
  }
}

/**
 * Project a create-PI / create-topup response down to the helper return shape.
 * `accountId` is omitted when undefined (skip-absent JSON parity).
 */
export function projectPaymentIntentResult(
  pi: PaymentIntentSource,
  customerRef: string,
): PaymentIntentProjection {
  const result: PaymentIntentProjection = {
    processorPaymentId: pi.processorPaymentId,
    clientSecret: pi.clientSecret,
    publishableKey: pi.publishableKey,
    customerRef,
  }
  if (pi.accountId !== undefined) {
    result.accountId = pi.accountId
  }
  return result
}

/**
 * Project a process-payment result down to the topup outcome shape.
 *
 * Unknown / missing status fails closed to `{ status: 'failed' }`.
 * Succeeded returns the bare marker — balance polling stays host-side.
 */
export function projectTopupProcessOutcome(
  status?: string,
  message?: string,
): TopupProcessOutcome {
  if (status === 'timeout') {
    return message !== undefined ? { status: 'timeout', message } : { status: 'timeout' }
  }
  if (status === 'failed') return { status: 'failed' }
  if (status === 'cancelled') return { status: 'cancelled' }
  if (status !== 'succeeded') {
    return { status: 'failed' }
  }
  return { status: 'succeeded' }
}
