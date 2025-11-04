/**
 * Subscription utility functions
 * 
 * Provides shared logic for filtering and prioritizing subscriptions
 */

import type { SubscriptionInfo } from '../types';

/**
 * Filter subscriptions based on cancellation status and endDate
 * 
 * Rules:
 * - Keep all non-cancelled subscriptions
 * - A subscription is considered cancelled if:
 *   1. status === 'cancelled', OR
 *   2. cancelledAt is set (even if status is still 'active' - this is expected behavior)
 * - Keep cancelled subscriptions only if they have an endDate in the future
 *   (meaning the subscription is cancelled but still active until the endDate)
 * - Filter out cancelled subscriptions without endDate or with past endDate
 */
export function filterSubscriptions(subscriptions: SubscriptionInfo[]): SubscriptionInfo[] {
  const now = new Date();
  
  const filtered = subscriptions.filter(sub => {
    const subAny = sub as any; // Type assertion to access optional properties
    
    // Check if subscription is cancelled (either by status or by cancelledAt timestamp)
    const isCancelled = sub.status === 'cancelled' || subAny.cancelledAt;
    
    // Keep all non-cancelled subscriptions
    if (!isCancelled) {
      return true;
    }
    
    // Keep cancelled subscriptions only if endDate exists and is in the future
    if (isCancelled && subAny.endDate) {
      const endDate = new Date(subAny.endDate);
      const isFuture = endDate > now;
      return isFuture;
    }
    
    // Filter out cancelled subscriptions without endDate or with past endDate
    return false;
  });
  
  return filtered;
}

/**
 * Get active subscriptions (excluding cancelled ones)
 * Also excludes subscriptions with cancelledAt set, even if status is still 'active'
 */
export function getActiveSubscriptions(subscriptions: SubscriptionInfo[]): SubscriptionInfo[] {
  const active = subscriptions.filter(sub => {
    const subAny = sub as any;
    // Exclude if status is cancelled or if cancelledAt is set
    return sub.status === 'active' && !subAny.cancelledAt;
  });
  
  return active;
}

/**
 * Get cancelled subscriptions with valid endDate (not expired)
 * Includes subscriptions with cancelledAt set, even if status is still 'active'
 */
export function getCancelledSubscriptionsWithEndDate(subscriptions: SubscriptionInfo[]): SubscriptionInfo[] {
  return subscriptions.filter(sub => {
    const subAny = sub as any; // Type assertion to access optional properties
    const isCancelled = sub.status === 'cancelled' || subAny.cancelledAt;
    return isCancelled && subAny.endDate && new Date(subAny.endDate) > new Date();
  });
}

/**
 * Get the most recent subscription by startDate
 */
export function getMostRecentSubscription(subscriptions: SubscriptionInfo[]): SubscriptionInfo | null {
  if (subscriptions.length === 0) return null;
  
  return subscriptions.reduce((latest, current) => {
    return new Date(current.startDate) > new Date(latest.startDate) ? current : latest;
  });
}

/**
 * Get the primary subscription to display
 * 
 * Prioritization:
 * 1. Active subscriptions (most recent by startDate)
 * 2. Cancelled subscriptions with endDate in the future (most recent by startDate)
 * 3. null if no valid subscriptions
 */
export function getPrimarySubscription(subscriptions: SubscriptionInfo[]): SubscriptionInfo | null {
  // First, filter subscriptions to only include valid ones
  const filtered = filterSubscriptions(subscriptions);
  
  // Prioritize active subscriptions
  const activeSubs = getActiveSubscriptions(filtered);
  if (activeSubs.length > 0) {
    return getMostRecentSubscription(activeSubs);
  }
  
  // If no active subscriptions, check for cancelled ones with endDate
  const cancelledWithEndDate = getCancelledSubscriptionsWithEndDate(filtered);
  if (cancelledWithEndDate.length > 0) {
    return getMostRecentSubscription(cancelledWithEndDate);
  }
  
  return null;
}

/**
 * Check if a subscription is paid
 * Uses subscription amount field: amount > 0 = paid, amount === 0 or undefined = free
 * 
 * @param sub - Subscription to check
 * @returns true if subscription is paid (amount > 0)
 */
export function isPaidSubscription(sub: SubscriptionInfo): boolean {
  return (sub.amount ?? 0) > 0;
}

