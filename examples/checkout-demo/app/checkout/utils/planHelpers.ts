import type { Plan } from '@solvapay/react';

/**
 * Format price from cents or dollars to display format
 */
export function formatPrice(price?: number): string {
  if (!price) return '0';
  return Math.floor(price).toString();
}

/**
 * Check if a plan is free
 */
export function isFreePlan(plan: Plan): boolean {
  return !plan.price || plan.price === 0 || plan.isFreeTier === true;
}

/**
 * Sort plans by price (ascending)
 */
export function sortPlansByPrice(a: Plan, b: Plan): number {
  return (a.price || 0) - (b.price || 0);
}

