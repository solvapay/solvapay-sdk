import { useMemo, useCallback } from 'react'
import type { PurchaseInfo, PurchaseStatusReturn } from '../types'
import { usePurchase } from './usePurchase'

/**
 * Hook providing advanced status and helper functions for purchase management
 *
 * Focuses on cancelled purchase logic and date formatting utilities.
 * For basic purchase data and paid status checks, use usePurchase() instead.
 *
 * @example
 * ```tsx
 * const { cancelledPurchase, shouldShowCancelledNotice, formatDate, getDaysUntilExpiration } = usePurchaseStatus();
 *
 * if (shouldShowCancelledNotice && cancelledPurchase) {
 *   const formattedDate = formatDate(cancelledPurchase.endDate);
 *   const daysLeft = getDaysUntilExpiration(cancelledPurchase.endDate);
 * }
 * ```
 */
export function usePurchaseStatus(): PurchaseStatusReturn {
  const { purchases } = usePurchase()

  // Helper to check if a purchase is paid
  // Only uses amount field: amount > 0 = paid, amount === 0 or undefined = free
  const isPaidPurchase = useCallback((p: PurchaseInfo): boolean => {
    return (p.amount ?? 0) > 0
  }, [])

  // Memoize purchase calculations for cancelled purchases
  // Backend keeps cancelled purchases as 'active' until expiration, tracked via cancelledAt
  const purchaseData = useMemo(() => {
    const cancelledPaidPurchases = purchases.filter(p => {
      // Look for purchases with cancelledAt set and status === 'active'
      return p.status === 'active' && p.cancelledAt && isPaidPurchase(p)
    })

    const cancelledPurchase =
      cancelledPaidPurchases.sort(
        (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime(),
      )[0] || null

    const shouldShowCancelledNotice = !!cancelledPurchase

    return {
      cancelledPurchase,
      shouldShowCancelledNotice,
    }
  }, [purchases, isPaidPurchase])

  // Format date helper
  const formatDate = useCallback((dateString?: string): string | null => {
    if (!dateString) return null
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }, [])

  // Calculate days until expiration
  const getDaysUntilExpiration = useCallback((endDate?: string): number | null => {
    if (!endDate) return null
    const now = new Date()
    const expiration = new Date(endDate)
    const diffTime = expiration.getTime() - now.getTime()
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    return diffDays > 0 ? diffDays : 0
  }, [])

  return {
    cancelledPurchase: purchaseData.cancelledPurchase,
    shouldShowCancelledNotice: purchaseData.shouldShowCancelledNotice,
    formatDate,
    getDaysUntilExpiration,
  }
}
