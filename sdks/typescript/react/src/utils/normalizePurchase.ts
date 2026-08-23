import type { OneTimePurchaseInfo } from '@solvapay/server'
import type { PurchaseInfo } from '../types'

/**
 * Normalise a `OneTimePurchaseInfo` from `processPaymentIntent` into a
 * `PurchaseInfo`-shaped row that the provider's `purchases` array
 * accepts. Mirrors what the backend bootstrap path emits for completed
 * one-time purchases so consumers reading `planSnapshot.planType ===
 * 'one-time'` can identify the row without a separate code path.
 */
export function normalizeOneTimePurchase(input: OneTimePurchaseInfo): PurchaseInfo {
  return {
    reference: input.reference,
    productName: '',
    productRef: input.productRef,
    status: 'active',
    startDate: input.completedAt,
    amount: input.amount,
    currency: input.currency,
    planType: 'one-time',
    isRecurring: false,
    planSnapshot: { planType: 'one-time' },
  }
}
