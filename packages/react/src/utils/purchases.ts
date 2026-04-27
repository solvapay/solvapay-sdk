/**
 * Purchase utility functions
 *
 * Provides shared logic for filtering and prioritizing purchases
 */

import type { PurchaseInfo } from '../types'

/**
 * Filter purchases to only include active ones
 *
 * Rules:
 * - Keep purchases with status === 'active'
 * - Filter out purchases with status === 'cancelled', 'expired', 'suspended', 'refunded', etc.
 *
 * Note: Backend now keeps purchases with status 'active' until expiration,
 * even when cancelled. Cancellation is tracked via cancelledAt field.
 */
export function filterPurchases(purchases: PurchaseInfo[]): PurchaseInfo[] {
  return purchases.filter(purchase => purchase.status === 'active')
}

/**
 * Get active purchases
 *
 * Returns purchases with status === 'active'.
 * Note: Backend keeps purchases as 'active' until expiration, even when cancelled.
 * Use cancelledAt field to check if a purchase is cancelled.
 */
export function getActivePurchases(purchases: PurchaseInfo[]): PurchaseInfo[] {
  return purchases.filter(purchase => purchase.status === 'active')
}

/**
 * Get cancelled purchases with valid endDate (not expired)
 *
 * Returns purchases with cancelledAt set and status === 'active' that have a future endDate.
 * Backend keeps cancelled purchases as 'active' until expiration.
 */
export function getCancelledPurchasesWithEndDate(
  purchases: PurchaseInfo[],
): PurchaseInfo[] {
  const now = new Date()
  return purchases.filter(purchase => {
    return (
      purchase.status === 'active' &&
      purchase.cancelledAt &&
      purchase.endDate &&
      new Date(purchase.endDate) > now
    )
  })
}

/**
 * Get the most recent purchase by startDate
 */
export function getMostRecentPurchase(
  purchases: PurchaseInfo[],
): PurchaseInfo | null {
  if (purchases.length === 0) return null

  return purchases.reduce((latest, current) => {
    return new Date(current.startDate) > new Date(latest.startDate) ? current : latest
  })
}

/**
 * Get the primary purchase to display
 *
 * Prioritization:
 * 1. Active purchases (most recent by startDate)
 * 2. null if no valid purchases
 *
 * Note: Backend keeps purchases as 'active' until expiration, so we only
 * need to check for active purchases. Cancelled purchases are still
 * active until their endDate.
 */
export function getPrimaryPurchase(purchases: PurchaseInfo[]): PurchaseInfo | null {
  // Filter to only include active purchases
  const filtered = filterPurchases(purchases)

  // Get most recent active purchase
  if (filtered.length > 0) {
    return getMostRecentPurchase(filtered)
  }

  return null
}

/**
 * Check if a purchase is paid
 * Uses purchase amount field: amount > 0 = paid, amount === 0 or undefined = free
 *
 * @param purchase - Purchase to check
 * @returns true if purchase is paid (amount > 0)
 */
export function isPaidPurchase(purchase: PurchaseInfo): boolean {
  return (purchase.amount ?? 0) > 0
}

/**
 * Classify a purchase as a plan (subscription / one-time / usage-based) vs a
 * balance transaction (credit top-up, and any future non-plan purposes).
 *
 * Primary signal is structural: a purchase with no `planSnapshot` was never a
 * plan. The `metadata.purpose` check is defense in depth — it keeps obvious
 * top-ups out of plan selectors even if a future backend regression
 * accidentally attaches a snapshot to one.
 *
 * @param purchase - Purchase to classify
 * @returns true when the purchase represents a plan
 */
export function isPlanPurchase(purchase: PurchaseInfo): boolean {
  return !!purchase.planSnapshot && purchase.metadata?.purpose !== 'credit_topup'
}

/**
 * Inverse of `isPlanPurchase` — balance transactions (credit top-ups today,
 * gift credits / refunds / bonuses tomorrow).
 */
export function isTopupPurchase(purchase: PurchaseInfo): boolean {
  return !isPlanPurchase(purchase)
}
