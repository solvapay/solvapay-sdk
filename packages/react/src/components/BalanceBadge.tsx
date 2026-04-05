'use client'

import { useBalance } from '../hooks/useBalance'
import type { BalanceBadgeProps } from '../types'

/**
 * Headless component that displays a customer's credit balance.
 *
 * With render prop:
 * ```tsx
 * <BalanceBadge currency="USD">
 *   {({ balance, loading }) => loading ? '...' : `$${(balance ?? 0) / 100}`}
 * </BalanceBadge>
 * ```
 *
 * Without render prop (renders formatted balance in a span):
 * ```tsx
 * <BalanceBadge currency="USD" className="text-sm font-medium" />
 * ```
 */
export function BalanceBadge({ currency, className, children }: BalanceBadgeProps) {
  const { balances, loading } = useBalance()

  const resolvedCurrency = currency || balances[0]?.currency || 'USD'
  const match = balances.find(
    b => b.currency.toUpperCase() === resolvedCurrency.toUpperCase(),
  )
  const balanceValue = match?.balance ?? null

  if (children) {
    return <>{children({ balance: balanceValue, loading, currency: resolvedCurrency })}</>
  }

  if (loading) {
    return <span className={className} aria-busy="true" />
  }

  if (balanceValue === null) {
    return null
  }

  const formatted = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: resolvedCurrency,
    minimumFractionDigits: 2,
  }).format(balanceValue / 100)

  return <span className={className}>{formatted}</span>
}
