'use client'

import { useBalance } from '../hooks/useBalance'
import type { BalanceBadgeProps } from '../types'

/**
 * Headless component that displays a customer's credit balance.
 *
 * With render prop:
 * ```tsx
 * <BalanceBadge>
 *   {({ balance, loading, currency }) => loading ? '...' : `$${(balance ?? 0) / 100}`}
 * </BalanceBadge>
 * ```
 *
 * Without render prop (renders formatted balance in a span):
 * ```tsx
 * <BalanceBadge className="text-sm font-medium" />
 * ```
 */
export function BalanceBadge({ className, children }: BalanceBadgeProps) {
  const { balance, currency, loading } = useBalance()

  if (children) {
    return <>{children({ balance, loading, currency })}</>
  }

  if (loading) {
    return <span className={className} aria-busy="true" />
  }

  if (balance === null || !currency) {
    return null
  }

  const formatted = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(balance / 100)

  return <span className={className}>{formatted}</span>
}
