"use client";
import React, { useState, useEffect, useRef } from 'react';
import { useSubscription } from '../hooks/useSubscription';
import type { PlanBadgeProps } from '../types';
import { getPrimarySubscription } from '../utils/subscriptions';

/**
 * Headless Plan Badge Component
 * 
 * Displays subscription status with complete styling control.
 * Supports render props, custom components, or className patterns.
 * 
 * Prevents flickering by hiding the badge during initial load and when no subscription exists.
 * Only shows the badge once loading completes AND a subscription value is available.
 * Badge only updates when the plan name actually changes (prevents unnecessary re-renders).
 * 
 * @example
 * ```tsx
 * // Render prop pattern
 * <PlanBadge>
 *   {({ subscriptions, loading, displayPlan, shouldShow }) => (
 *     shouldShow ? (
 *       <div>{displayPlan}</div>
 *     ) : null
 *   )}
 * </PlanBadge>
 * 
 * //ClassName pattern
 * <PlanBadge className="badge badge-primary" />
 * ```
 */
export const PlanBadge: React.FC<PlanBadgeProps> = ({
  children,
  as: Component = 'div',
  className,
}) => {
  const { subscriptions, loading } = useSubscription();
  const [displayPlan, setDisplayPlan] = useState<string | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  
  // Refs for tracking previous values and preventing race conditions
  const lastPlanRef = useRef<string | null>(null);
  const lastLoadingRef = useRef<boolean>(true); // Start as true (initial loading state)
  const previousSubscriptionsRef = useRef<typeof subscriptions>(subscriptions);

  // Use shared utility to get primary subscription (prioritizes active over cancelled)
  const primarySubscription = getPrimarySubscription(subscriptions);
  const currentPlanName = primarySubscription?.planName || null;
  
  // Fallback: if primarySubscription is null but we have subscriptions, use the first one
  // This handles edge cases where getPrimarySubscription filters out valid subscriptions
  const fallbackPlanName = subscriptions.length > 0 && !currentPlanName 
    ? subscriptions[0]?.planName || null
    : null;
  
  const effectivePlanName = currentPlanName || fallbackPlanName;

  // Track when loading completes (not when subscriptions exist)
  // This handles the case where loading finishes but subscriptions array is empty
  // Also handles the case where loading starts as false (already loaded)
  useEffect(() => {
    // Simple: if loading is false, we've loaded (either completed or started as false)
    // Only set once to avoid unnecessary re-renders
    if (!loading && !hasLoadedOnce) {
      setHasLoadedOnce(true);
    }
    
    // Track loading state for potential future use
    lastLoadingRef.current = loading;
  }, [loading, hasLoadedOnce]);

  // Detect customerRef changes (when subscriptions array reference changes)
  // Reset state when customer changes to prevent stale data
  // Note: Subscriptions array reference changes when customerRef changes OR when refetching
  // We reset state conservatively - if loading, state will be restored when loading completes
  useEffect(() => {
    const previousSubs = previousSubscriptionsRef.current;
    
    // Check if subscriptions array reference changed
    // This happens when customerRef changes OR when subscriptions are refetched
    if (previousSubs !== subscriptions) {
      // Only reset hasLoadedOnce if we're currently loading (new fetch in progress)
      // If not loading, keep hasLoadedOnce true to prevent flickering on refetches
      if (loading) {
        setHasLoadedOnce(false);
      }
      
      // Always reset displayPlan and lastPlanRef when subscriptions change
      // This ensures we show the latest plan name
      setDisplayPlan(null);
      lastPlanRef.current = null;
      previousSubscriptionsRef.current = subscriptions;
    }
  }, [subscriptions, loading]);

  // Update display plan when plan name changes
  // Only update when effectivePlanName actually changes (prevents unnecessary re-renders)
  // Also handle case where effectivePlanName becomes null
  useEffect(() => {
    const currentPlan = effectivePlanName;
    const previousPlan = lastPlanRef.current;
    
    if (currentPlan !== previousPlan) {
      // Plan name changed - update displayPlan
      if (currentPlan !== null) {
        lastPlanRef.current = currentPlan;
        setDisplayPlan(currentPlan);
      } else {
        // Plan name became null - clear displayPlan
        lastPlanRef.current = null;
        setDisplayPlan(null);
      }
    } else if (currentPlan !== null && displayPlan === null) {
      // Initialize displayPlan if it's null but we have an effectivePlanName
      // This handles the case where displayPlan was reset but effectivePlanName is still valid
      setDisplayPlan(currentPlan);
    }
  }, [effectivePlanName, displayPlan]);

  // Determine if badge should be shown
  // Show if: loading has completed AND we have a plan name
  // This ensures badge only appears after initial load completes (prevents flickering)
  const shouldShow = effectivePlanName !== null && hasLoadedOnce;
  
  // Use displayPlan if available, otherwise fall back to effectivePlanName
  // displayPlan is stable (only changes when plan name actually changes)
  const planToDisplay = displayPlan ?? effectivePlanName;

  // If using render prop pattern
  if (children) {
    return <>{children({ subscriptions, loading, displayPlan: planToDisplay, shouldShow })}</>;
  }

  // Hide badge if we shouldn't show it
  if (!shouldShow) {
    return null;
  }

  // Determine className
  const computedClassName = typeof className === 'function' 
    ? className({ subscriptions })
    : className;

  return (
    <Component 
      className={computedClassName}
      data-loading={loading}
      data-has-subscription={!!primarySubscription}
      role="status"
      aria-live="polite"
      aria-busy={loading}
      aria-label={`Current plan: ${planToDisplay}`}
    >
      {planToDisplay}
    </Component>
  );
};

