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
 *   - `payment_required` (paid plan gate)
 *                              → `hasPaidPurchase && activePurchase.productRef === content.product`
 *   - `payment_required` (topup-shaped gate, carries `content.balance`)
 *                              → also resolves on wallet replenishment
 *                                (`balance.remainingUnits > 0` or
 *                                 `credits >= balance.creditsPerUnit`).
 *                                Topups don't create paid plan purchases,
 *                                so `hasPaidPurchase` alone would never
 *                                flip — we treat the balance block the
 *                                same way the activation_required branch
 *                                does.
 *   - `activation_required` + balance-gated
 *                              → `credits >= content.balance.creditsPerUnit`
 *   - `activation_required` (no balance)
 *                              → `activePurchase.status === 'active' && activePurchase.productRef === content.product`
 */

import { useCallback, useMemo } from 'react'
import type { LimitActivationBalance, PaywallStructuredContent } from '@solvapay/server'
import { usePurchase } from './usePurchase'
import { useBalance } from './useBalance'

export interface UsePaywallResolverReturn {
  /** `true` once the paywall requirement is met. */
  resolved: boolean
  /** Refetch the underlying purchase + balance state. */
  refetch: () => Promise<void>
}

/**
 * Shared balance check used by both `payment_required` (topup-shaped)
 * and `activation_required` resolution paths. `LimitBalanceDto` models
 * "what the customer has", so any positive `remainingUnits` margin or a
 * live `credits` value covering the next unit means the gate is cleared.
 */
function balanceCoversNextUnit(
  balance: LimitActivationBalance | undefined,
  credits: number | null,
): boolean {
  if (!balance) return false
  if (typeof balance.remainingUnits === 'number' && balance.remainingUnits > 0) {
    return true
  }
  if (credits != null && balance.creditsPerUnit && credits >= balance.creditsPerUnit) {
    return true
  }
  return false
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
      if (hasPaidPurchase && productMatches) return true
      // Topup-shaped `payment_required`: customer has an active
      // usage-based plan but ran out of credits, so the backend emits
      // `payment_required` with a `balance` block instead of
      // `activation_required`. A topup creates a balance transaction
      // (not a paid plan purchase), so `hasPaidPurchase` would never
      // flip — fall back to the same wallet-replenishment check the
      // activation_required branch uses.
      return balanceCoversNextUnit(content.balance, credits)
    }

    // activation_required — resolves once the customer has an active
    // purchase on the product, OR their credit balance covers the next
    // remaining unit.
    if (balanceCoversNextUnit(content.balance, credits)) return true
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
