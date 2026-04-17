import type { ProcessPaymentResult } from '@solvapay/server'
import type { SolvaPayCopy } from '../i18n/types'

/**
 * Post-Stripe-confirmation reconciliation with the SolvaPay backend.
 *
 * Invokes the provider's `processPayment`, retries purchase refetch on
 * timeout, and returns a discriminated result so the caller (PaymentForm,
 * custom consumers) can route to `onSuccess` / `onError` consistently.
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
  | { status: 'success' }
  | { status: 'timeout'; error: Error }
  | { status: 'error'; error: Error }

export async function reconcilePayment(
  input: ReconcilePaymentInput,
): Promise<ReconcilePaymentResult> {
  const { paymentIntentId, productRef, planRef, processPayment, refetchPurchase, copy } = input

  if (!processPayment || !productRef) {
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
    const isTimeout =
      (result as unknown as { status?: string })?.status === 'timeout'

    if (isTimeout) {
      for (let attempt = 1; attempt <= 5; attempt++) {
        await new Promise(resolve => setTimeout(resolve, attempt * 1000))
        await refetchPurchase()
      }
      return {
        status: 'timeout',
        error: new Error(copy.errors.paymentProcessingTimeout),
      }
    }

    await refetchPurchase()
    return { status: 'success' }
  } catch (err) {
    return {
      status: 'error',
      error: err instanceof Error ? err : new Error(String(err)),
    }
  }
}
