"use client";
import React from 'react';
import { useSubscription } from '../hooks/useSubscription';
import type { SubscriptionGateProps } from '../types';

/**
 * Headless Subscription Gate Component
 * 
 * Controls access to content based on subscription status.
 * Uses render props to give developers full control over locked/unlocked states.
 * 
 * @example
 * ```tsx
 * <SubscriptionGate requirePlan="Pro Plan">
 *   {({ hasAccess, loading }) => {
 *     if (loading) return <Skeleton />;
 *     if (!hasAccess) return <Paywall />;
 *     return <PremiumContent />;
 *   }}
 * </SubscriptionGate>
 * ```
 */
export const SubscriptionGate: React.FC<SubscriptionGateProps> = ({
  requirePlan,
  children,
}) => {
  const { subscriptions, loading, hasPlan } = useSubscription();

  const hasAccess = requirePlan ? hasPlan(requirePlan) : subscriptions.some(sub => sub.status === 'active');

  return (
    <>
      {children({
        hasAccess,
        subscriptions,
        loading,
      })}
    </>
  );
};

