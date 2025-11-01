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
 * - Keep cancelled subscriptions only if they have an endDate in the future
 * - Filter out cancelled subscriptions without endDate or with past endDate
 */
export function filterSubscriptions(subscriptions: SubscriptionInfo[]): SubscriptionInfo[] {
  return subscriptions.filter(sub => {
    // Keep all non-cancelled subscriptions
    if (sub.status !== 'cancelled') return true;
    
    // Keep cancelled subscriptions only if endDate exists and is in the future
    if (sub.status === 'cancelled' && sub.endDate) {
      return new Date(sub.endDate) > new Date();
    }
    
    // Filter out cancelled subscriptions without endDate or with past endDate
    return false;
  });
}

/**
 * Get active subscriptions (excluding cancelled ones)
 */
export function getActiveSubscriptions(subscriptions: SubscriptionInfo[]): SubscriptionInfo[] {
  return subscriptions.filter(sub => sub.status === 'active');
}

/**
 * Get cancelled subscriptions with valid endDate (not expired)
 */
export function getCancelledSubscriptionsWithEndDate(subscriptions: SubscriptionInfo[]): SubscriptionInfo[] {
  return subscriptions.filter(sub => {
    return sub.status === 'cancelled' && sub.endDate && new Date(sub.endDate) > new Date();
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
 * Check if user has an active paid subscription
 * 
 * @param subscriptions - Array of subscriptions
 * @param isPaidPlan - Function to check if a plan name represents a paid plan
 */
export function hasActivePaidSubscription(
  subscriptions: SubscriptionInfo[],
  isPaidPlan: (planName: string) => boolean
): boolean {
  const filtered = filterSubscriptions(subscriptions);
  
  // Check for active paid subscriptions first
  const activePaid = getActiveSubscriptions(filtered).some(sub => isPaidPlan(sub.planName));
  if (activePaid) return true;
  
  // Check for cancelled paid subscriptions with endDate
  const cancelledPaid = getCancelledSubscriptionsWithEndDate(filtered).some(sub => isPaidPlan(sub.planName));
  return cancelledPaid;
}

