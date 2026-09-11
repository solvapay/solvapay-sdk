import { evaluateBalanceObservation } from '../native-decisions'

export const TOPUP_BALANCE_POLL_DELAYS_MS = [500, 1000, 2000, 4000] as const

/** Backoff for client-side balance reconciliation after async credit top-ups (e.g. auto-recharge). */
export const BALANCE_RECONCILE_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 16000] as const

export async function pollBalanceUntilIncreased(
  getBalance: () => Promise<{ credits: number }>,
  baseline: number,
  delays: readonly number[] = BALANCE_RECONCILE_DELAYS_MS,
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
