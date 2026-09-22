/**
 * Client-side balance reconciliation helpers.
 *
 * Delay tables come from `@solvapay/core` (same binding as the server). Do not
 * import `@solvapay/server` here — that barrel installs Node/WASM bindings.
 */

import { BALANCE_RECONCILE_DELAYS_MS as balanceReconcileDelaysMs } from '@solvapay/core'

export { BALANCE_RECONCILE_DELAYS_MS } from '@solvapay/core'

export async function pollBalanceUntilIncreased(
  getBalance: () => Promise<{ credits: number }>,
  baseline: number,
  delays: readonly number[] = balanceReconcileDelaysMs(),
): Promise<{ creditsAdded: number } | null> {
  for (const delay of delays) {
    await new Promise<void>(resolve => setTimeout(resolve, delay))
    try {
      const post = await getBalance()
      if (post.credits > baseline) {
        return { creditsAdded: post.credits - baseline }
      }
    } catch {
      // ignore — try the next delay
    }
  }
  return null
}
