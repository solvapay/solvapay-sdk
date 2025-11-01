"use client";
import React from 'react';
import { useSubscription } from '../hooks/useSubscription';
import type { PlanBadgeProps } from '../types';
import { getPrimarySubscription } from '../utils/subscriptions';

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
  // Use shared utility to get primary subscription (prioritizes active over cancelled)
  const primarySubscription = getPrimarySubscription(subscriptions);
  
  const displayText = loading 
    ? 'Loading...' 
    : primarySubscription 
      ? primarySubscription.planName
      : 'Free';

  return (
    <Component 
      className={computedClassName}
      data-loading={loading}
      data-has-subscription={!!primarySubscription}
      role="status"
      aria-live="polite"
      aria-busy={loading}
      aria-label={loading ? 'Loading subscription status' : `Current plan: ${displayText}`}
    >
      {displayText}
    </Component>
  );
};

