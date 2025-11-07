/**
 * Subscription utility functions
 * 
 * Provides shared logic for filtering and prioritizing subscriptions
 */

import type { SubscriptionInfo } from '../types';

/**
 * Filter subscriptions to only include active ones
 * 
 * Rules:
 * - Keep subscriptions with status === 'active'
 * - Filter out subscriptions with status === 'cancelled', 'expired', 'suspended', 'refunded', etc.
 * 
 * Note: Backend now keeps subscriptions with status 'active' until expiration,
 * even when cancelled. Cancellation is tracked via cancelledAt field.
 */
export function filterSubscriptions(subscriptions: SubscriptionInfo[]): SubscriptionInfo[] {
  return subscriptions.filter(sub => sub.status === 'active');
}

/**
 * Get active subscriptions
 * 
 * Returns subscriptions with status === 'active'.
 * Note: Backend keeps subscriptions as 'active' until expiration, even when cancelled.
 * Use cancelledAt field to check if a subscription is cancelled.
 */
export function getActiveSubscriptions(subscriptions: SubscriptionInfo[]): SubscriptionInfo[] {
  return subscriptions.filter(sub => sub.status === 'active');
}

/**
 * Get cancelled subscriptions with valid endDate (not expired)
 * 
 * Returns subscriptions with cancelledAt set and status === 'active' that have a future endDate.
 * Backend keeps cancelled subscriptions as 'active' until expiration.
 */
export function getCancelledSubscriptionsWithEndDate(subscriptions: SubscriptionInfo[]): SubscriptionInfo[] {
  const now = new Date();
  return subscriptions.filter(sub => {
    const subAny = sub as any; // Type assertion to access optional properties
    return sub.status === 'active' && subAny.cancelledAt && subAny.endDate && new Date(subAny.endDate) > now;
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
 * 2. null if no valid subscriptions
 * 
 * Note: Backend keeps subscriptions as 'active' until expiration, so we only
 * need to check for active subscriptions. Cancelled subscriptions are still
 * active until their endDate.
 */
export function getPrimarySubscription(subscriptions: SubscriptionInfo[]): SubscriptionInfo | null {
  // Filter to only include active subscriptions
  const filtered = filterSubscriptions(subscriptions);
  
  // Get most recent active subscription
  if (filtered.length > 0) {
    return getMostRecentSubscription(filtered);
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

