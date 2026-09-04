import { useEffect } from 'react'
import { useSolvaPay } from './useSolvaPay'
import type { BalanceStatus } from '../types'

/**
 * Hook to get the current customer's credits.
 *
 * Automatically fetches on mount and re-fetches when
 * authentication state changes (ensures credits load
 * even when auth resolves after initial render).
 *
 * @example
 * ```tsx
 * const { credits, displayCurrency, loading, refetch } = useBalance()
 * ```
 */
export function useBalance(): BalanceStatus {
  const { balance } = useSolvaPay()

  useEffect(() => {
    balance.refetch()
  }, [balance.refetch])

  return balance
}
