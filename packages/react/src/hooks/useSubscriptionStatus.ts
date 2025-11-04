import { useMemo, useCallback } from 'react';
import type { Plan, SubscriptionInfo, SubscriptionStatusReturn } from '../types';
import { useSubscription } from './useSubscription';

/**
 * Hook providing status and helper functions for subscription management
 * 
 * Provides utilities for checking subscription status, formatting dates,
 * and working with paid vs free plans.
 * 
 * @param plans - Array of available plans to determine if a subscription is paid
 * 
 * @example
 * ```tsx
 * const status = useSubscriptionStatus(plans);
 * 
 * if (status.isPaidPlan('Pro Plan')) {
 *   // Handle paid plan
 * }
 * 
 * const daysLeft = status.getDaysUntilExpiration(subscription.endDate);
 * ```
 */
export function useSubscriptionStatus(plans: Plan[]): SubscriptionStatusReturn {
  const { subscriptions } = useSubscription();

  // Helper to check if a subscription is for a paid plan
  const isPaidPlan = useCallback((planName: string): boolean => {
    const plan = plans.find(p => p.name === planName);
    return plan ? (plan.price ?? 0) > 0 && !plan.isFreeTier : true;
  }, [plans]);

  // Memoize subscription calculations
  const subscriptionData = useMemo(() => {
    const activePaidSubscriptions = subscriptions.filter(
      sub => sub.status === 'active' && isPaidPlan(sub.planName)
    );
    
    const activePaidSubscription = activePaidSubscriptions
      .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())[0] || null;
    
    const cancelledPaidSubscriptions = subscriptions.filter(
      sub => sub.status === 'cancelled' && isPaidPlan(sub.planName)
    );
    
    const cancelledSubscription = cancelledPaidSubscriptions
      .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())[0] || null;
    
    const hasActiveSubscription = subscriptions.some(sub => sub.status === 'active');
    const shouldShowCancelledNotice = !!(cancelledSubscription && 
      (!hasActiveSubscription || cancelledSubscription.endDate));
    
    return {
      activePaidSubscription,
      activePlanName: activePaidSubscription?.planName || null,
      cancelledSubscription,
      hasPaidSubscription: activePaidSubscriptions.length > 0,
      shouldShowCancelledNotice,
    };
  }, [subscriptions, isPaidPlan]);

  // Format date helper
  const formatDate = useCallback((dateString?: string): string | null => {
    if (!dateString) return null;
    return new Date(dateString).toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  }, []);

  // Calculate days until expiration
  const getDaysUntilExpiration = useCallback((endDate?: string): number | null => {
    if (!endDate) return null;
    const now = new Date();
    const expiration = new Date(endDate);
    const diffTime = expiration.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : 0;
  }, []);

  return {
    isPaidPlan,
    activePaidSubscription: subscriptionData.activePaidSubscription,
    cancelledSubscription: subscriptionData.cancelledSubscription,
    hasPaidSubscription: subscriptionData.hasPaidSubscription,
    shouldShowCancelledNotice: subscriptionData.shouldShowCancelledNotice,
    activePlanName: subscriptionData.activePlanName,
    formatDate,
    getDaysUntilExpiration,
  };
}

