import { useMemo, useCallback } from 'react'
import type { SubscriptionInfo, SubscriptionStatusReturn } from '../types'
import { useSubscription } from './useSubscription'

/**
 * Hook providing advanced status and helper functions for subscription management
 *
 * Focuses on cancelled subscription logic and date formatting utilities.
 * For basic subscription data and paid status checks, use useSubscription() instead.
 *
 * @example
 * ```tsx
 * const { cancelledSubscription, shouldShowCancelledNotice, formatDate, getDaysUntilExpiration } = useSubscriptionStatus();
 *
 * if (shouldShowCancelledNotice && cancelledSubscription) {
 *   const formattedDate = formatDate(cancelledSubscription.endDate);
 *   const daysLeft = getDaysUntilExpiration(cancelledSubscription.endDate);
 * }
 * ```
 */
export function useSubscriptionStatus(): SubscriptionStatusReturn {
  const { subscriptions } = useSubscription()

  // Helper to check if a subscription is paid
  // Only uses amount field: amount > 0 = paid, amount === 0 or undefined = free
  const isPaidSubscription = useCallback((sub: SubscriptionInfo): boolean => {
    return (sub.amount ?? 0) > 0
  }, [])

  // Memoize subscription calculations for cancelled subscriptions
  // Backend keeps cancelled subscriptions as 'active' until expiration, tracked via cancelledAt
  const subscriptionData = useMemo(() => {
    const cancelledPaidSubscriptions = subscriptions.filter(sub => {
      const subAny = sub as any // Type assertion to access optional properties
      // Look for subscriptions with cancelledAt set and status === 'active'
      return sub.status === 'active' && subAny.cancelledAt && isPaidSubscription(sub)
    })

    const cancelledSubscription =
      cancelledPaidSubscriptions.sort(
        (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime(),
      )[0] || null

    const shouldShowCancelledNotice = !!cancelledSubscription

    return {
      cancelledSubscription,
      shouldShowCancelledNotice,
    }
  }, [subscriptions, isPaidSubscription])

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
    cancelledSubscription: subscriptionData.cancelledSubscription,
    shouldShowCancelledNotice: subscriptionData.shouldShowCancelledNotice,
    formatDate,
    getDaysUntilExpiration,
  }
}
