import type { Plan } from '@solvapay/react';

/**
 * Format price from cents to display format (dollars)
 */
export function formatPrice(price?: number): string {
  if (!price) return '0';
  // Convert cents to dollars and format with 2 decimal places
  const dollars = price / 100;
  const formatted = dollars.toFixed(2);
  // Remove trailing zeros and decimal point if decimals are .00
  return formatted.replace(/\.00$/, '');
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

