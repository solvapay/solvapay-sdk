import type { OneTimePurchaseInfo } from '@solvapay/server'
import type { PurchaseInfo } from '../types'

/**
 * Normalise a `OneTimePurchaseInfo` from `processPaymentIntent` into a
 * `PurchaseInfo`-shaped row that the provider's `purchases` array
 * accepts. `isPlanPurchase` keys off a present `planSnapshot`, so the
 * snapshot must be non-null. Shape is derived from primitives
 * (`isRecurring: false`, snapshot `isMetered: false`) — there is no
 * `planType` on the wire.
 */
export function normalizeOneTimePurchase(input: OneTimePurchaseInfo): PurchaseInfo {
  return {
    reference: input.reference,
    customerRef: input.customerRef,
    productName: input.productRef,
    productRef: input.productRef,
    status: 'active',
    startDate: input.completedAt,
    createdAt: input.createdAt,
    amount: input.amount,
    currency: input.currency,
    isRecurring: false,
    origin: 'one_time',
    planSnapshot: {
      price: input.amount,
      currency: input.currency,
      isMetered: false,
    },
  }
}
