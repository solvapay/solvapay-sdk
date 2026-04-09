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
 * Format credits per unit as a display price.
 */
export function formatPerUnitPrice(creditsPerUnit?: number): string {
  if (!creditsPerUnit) return '0'
  const displayAmount = creditsPerUnit / 100
  if (displayAmount >= 1) return displayAmount.toFixed(2).replace(/\.00$/, '')
  if (displayAmount >= 0.01) return displayAmount.toFixed(2)
  return displayAmount.toFixed(4).replace(/0+$/, '')
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
