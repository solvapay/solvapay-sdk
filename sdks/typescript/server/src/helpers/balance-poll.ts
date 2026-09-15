import { evaluateBalanceObservation } from '../native-decisions'
import { BALANCE_RECONCILE_DELAYS_MS as balanceReconcileDelaysMs } from '@solvapay/core'

export { BALANCE_RECONCILE_DELAYS_MS, TOPUP_BALANCE_POLL_DELAYS_MS } from '@solvapay/core'

export async function pollBalanceUntilIncreased(
  getBalance: () => Promise<{ credits: number }>,
  baseline: number,
  delays: readonly number[] = balanceReconcileDelaysMs(),
): Promise<{ creditsAdded: number } | null> {
  for (const delay of delays) {
    await new Promise<void>(resolve => setTimeout(resolve, delay))
    try {
      const post = await getBalance()
      const delta = evaluateBalanceObservation(baseline, post.credits)
      if (delta !== null) {
        return { creditsAdded: delta }
      }
    } catch {
      // ignore — try the next delay
    }
  }
  return null
}
