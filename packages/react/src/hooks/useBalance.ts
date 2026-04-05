import { useEffect } from 'react'
import { useSolvaPay } from './useSolvaPay'
import type { BalanceStatus } from '../types'

/**
 * Hook to get the current customer's credit balance.
 *
 * Automatically fetches on mount and re-fetches when
 * authentication state changes (ensures balance loads
 * even when auth resolves after initial render).
 *
 * @example
 * ```tsx
 * const { balances, loading, refetch } = useBalance()
 *
 * const usdBalance = balances.find(b => b.currency === 'USD')
 * ```
 */
export function useBalance(): BalanceStatus {
  const { balance } = useSolvaPay()

  useEffect(() => {
    balance.refetch()
  }, [balance.refetch])

  return balance
}
