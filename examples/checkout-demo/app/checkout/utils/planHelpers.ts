import type { Plan } from '@solvapay/react'

/**
 * Format price from cents to display format (dollars)
 */
export function formatPrice(price?: number): string {
  if (!price) return '0'
  const dollars = price / 100
  const formatted = dollars.toFixed(2)
  return formatted.replace(/\.00$/, '')
}

/**
 * Format a per-unit price (cents, possibly fractional like 0.1)
 */
export function formatPerUnitPrice(pricePerUnit?: number): string {
  if (!pricePerUnit) return '0'
  const dollars = pricePerUnit / 100
  if (dollars >= 1) return dollars.toFixed(2).replace(/\.00$/, '')
  if (dollars >= 0.01) return dollars.toFixed(2)
  return dollars.toFixed(4).replace(/0+$/, '')
}

export function isUsageBasedPlan(plan: Plan): boolean {
  return plan.type === 'usage-based'
}

export function isFreePlan(plan: Plan): boolean {
  return plan.requiresPayment === false
}

export function sortPlansByPrice(a: Plan, b: Plan): number {
  return (a.price || 0) - (b.price || 0)
}
