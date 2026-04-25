'use client'

/**
 * `usePaywallResolver(content)` — observe provider state and flip `resolved`
 * the moment the paywall requirement is satisfied.
 *
 * Used by `<PaywallNotice.Retry>` (and by web-app integrators driving their
 * own retry UI). Never fetches directly — purely a derived view of
 * `usePurchase` + `useBalance`.
 *
 * Resolution predicates:
 *   - `payment_required`       → `hasPaidPurchase && activePurchase.productRef === content.product`
 *   - `activation_required` + balance-gated
 *                              → `credits >= content.balance.required`
 *   - `activation_required` (no balance)
 *                              → `activePurchase.status === 'active' && activePurchase.productRef === content.product`
 */

import { useCallback, useMemo } from 'react'
import type { PaywallStructuredContent } from '@solvapay/server'
import { usePurchase } from './usePurchase'
import { useBalance } from './useBalance'

export interface UsePaywallResolverReturn {
  /** `true` once the paywall requirement is met. */
  resolved: boolean
  /** Refetch the underlying purchase + balance state. */
  refetch: () => Promise<void>
}

export function usePaywallResolver(
  content: PaywallStructuredContent,
): UsePaywallResolverReturn {
  const { activePurchase, hasPaidPurchase, refetch: refetchPurchase } = usePurchase()
  const { credits, refetch: refetchBalance } = useBalance()

  const resolved = useMemo<boolean>(() => {
    if (!content) return false
    const productMatches =
      !content.product ||
      activePurchase?.productRef === content.product ||
      activePurchase?.productName === content.product

    if (content.kind === 'payment_required') {
      return Boolean(hasPaidPurchase && productMatches)
    }

    // activation_required — resolves once the customer has an active
    // purchase on the product, OR their credit balance covers the next
    // remaining unit (derived from `balance.remainingUnits` /
    // `creditsPerUnit`). `LimitBalanceDto` models "what the customer has",
    // not "what's required", so we treat any positive remaining-unit
    // margin as resolved.
    const balance = content.balance
    if (balance && typeof balance.remainingUnits === 'number' && balance.remainingUnits > 0) {
      return true
    }
    if (balance && credits != null && balance.creditsPerUnit && credits >= balance.creditsPerUnit) {
      return true
    }
    return Boolean(productMatches && activePurchase?.status === 'active')
  }, [content, hasPaidPurchase, activePurchase, credits])

  const refetch = useCallback(async () => {
    await Promise.all([
      refetchPurchase().catch(() => undefined),
      refetchBalance().catch(() => undefined),
    ])
  }, [refetchPurchase, refetchBalance])

  return { resolved, refetch }
}
