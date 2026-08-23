/**
 * Client-side balance reconciliation helpers.
 *
 * Kept local (not imported from `@solvapay/server`) so the React client bundle
 * never pulls the server barrel — that entry installs native/WASM bindings.
 */

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
      if (post.credits > baseline) {
        return { creditsAdded: post.credits - baseline }
      }
    } catch {
      // ignore — try the next delay
    }
  }
  return null
}
