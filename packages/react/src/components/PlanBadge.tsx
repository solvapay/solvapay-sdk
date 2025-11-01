"use client";
import React from 'react';
import { useSubscription } from '../hooks/useSubscription';
import type { PlanBadgeProps } from '../types';

/**
 * Headless Plan Badge Component
 * 
 * Displays subscription status with complete styling control.
 * Supports render props, custom components, or className patterns.
 * 
 * @example
 * ```tsx
 * // Render prop pattern
 * <PlanBadge>
 *   {({ subscriptions, loading }) => (
 *     <div>
 *       {subscriptions.map(sub => <span key={sub.reference}>{sub.planName}</span>)}
 *     </div>
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

  // If using render prop pattern
  if (children) {
    return <>{children({ subscriptions, loading })}</>;
  }

  // Determine className
  const computedClassName = typeof className === 'function' 
    ? className({ subscriptions })
    : className;

  // Default rendering with className
  const activeSubs = subscriptions.filter(sub => sub.status === 'active');
  
  // Get the latest active subscription by startDate
  const latestSub = activeSubs.length > 0
    ? activeSubs.reduce((latest, current) => {
        return new Date(current.startDate) > new Date(latest.startDate) ? current : latest;
      })
    : null;
  
  const displayText = loading 
    ? 'Loading...' 
    : latestSub 
      ? latestSub.planName
      : 'Free';

  return (
    <Component 
      className={computedClassName}
      data-loading={loading}
      data-has-subscription={activeSubs.length > 0}
      role="status"
      aria-live="polite"
      aria-busy={loading}
      aria-label={loading ? 'Loading subscription status' : `Current plan: ${displayText}`}
    >
      {displayText}
    </Component>
  );
};

