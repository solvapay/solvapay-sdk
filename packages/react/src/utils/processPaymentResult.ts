import type { ProcessPaymentResult } from '@solvapay/server'
import type { SolvaPayCopy } from '../i18n/types'

/**
 * Post-Stripe-confirmation reconciliation with the SolvaPay backend.
 *
 * Invokes the provider's `processPayment`, retries purchase refetch on
 * timeout, and returns a discriminated result so the caller (PaymentForm,
 * custom consumers) can route to `onSuccess` / `onError` consistently.
 *
 * On success, the `ProcessPaymentResult` is propagated to the caller via
 * `result`. The caller is expected to merge the contained purchase into
 * provider state synchronously (via `useSolvaPay().upsertPurchase`),
 * which is why this helper no longer calls `refetchPurchase()` on the
 * happy path — a synchronous merge is strictly stronger than an async
 * refetch and removes a stale-closure footgun in the caller.
 *
 * The legacy `!processPayment || !productRef` branch (no SDK
 * `processPayment` available) still falls back to `refetchPurchase()`
 * and reports `{ status: 'success' }` with no `result` — callers can
 * route on `result` presence to know whether to upsert or trust the
 * refetch.
 */
export type ReconcilePaymentInput = {
  paymentIntentId: string
  productRef?: string
  planRef?: string
  processPayment?: (params: {
    paymentIntentId: string
    productRef: string
    planRef?: string
  }) => Promise<ProcessPaymentResult>
  refetchPurchase: () => Promise<void>
  copy: SolvaPayCopy
}

export type ReconcilePaymentResult =
  | { status: 'success'; result?: ProcessPaymentResult }
  | { status: 'pending'; error: Error }
  | { status: 'timeout'; error: Error }
  | { status: 'error'; error: Error }

export async function reconcilePayment(
  input: ReconcilePaymentInput,
): Promise<ReconcilePaymentResult> {
  const { paymentIntentId, productRef, planRef, processPayment, refetchPurchase, copy } = input

  if (!processPayment || !productRef) {
    // Compat shim: integrators with a stub or partial transport that
    // can't run `processPaymentIntent` fall back to a purchase refetch.
    // The caller sees `result === undefined` and refetches itself if
    // needed.
    try {
      await refetchPurchase()
      return { status: 'success' }
    } catch (err) {
      return {
        status: 'error',
        error: err instanceof Error ? err : new Error(String(err)),
      }
    }
  }

  try {
    const result = await processPayment({ paymentIntentId, productRef, planRef })
    const { status } = result

    if (status === 'timeout') {
      for (let attempt = 1; attempt <= 5; attempt++) {
        await new Promise(resolve => setTimeout(resolve, attempt * 1000))
        await refetchPurchase()
      }
      return {
        status: 'timeout',
        error: new Error(copy.errors.paymentProcessingTimeout),
      }
    }

    if (status === 'processing') {
      return {
        status: 'pending',
        error: new Error(copy.errors.paymentPending),
      }
    }

    if (status === 'failed' || status === 'cancelled') {
      return {
        status: 'error',
        error: new Error(copy.errors.paymentProcessingFailed),
      }
    }

    return { status: 'success', result }
  } catch (err) {
    return {
      status: 'error',
      error: err instanceof Error ? err : new Error(String(err)),
    }
  }
}
