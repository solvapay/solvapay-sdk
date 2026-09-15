import type { AutoRechargeConfig } from '@solvapay/server'

type AutoRechargeStatus = AutoRechargeConfig['status']

export type ActivationPollOptions = {
  /** Force-refetch the auto-recharge config from the server. */
  refresh: (force?: boolean) => Promise<void>
  /** Read the latest known config status after a refresh. */
  getStatus: () => AutoRechargeStatus | undefined
  /** Maximum number of refresh attempts before giving up. */
  attempts?: number
  /** Delay between attempts, in milliseconds. */
  delayMs?: number
  /** Injectable sleep — overridden in tests for determinism. */
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/**
 * Poll the server until the auto-recharge config reaches `active`, confirming a
 * SetupIntent succeeded server-side (via webhook) rather than trusting the
 * client-side confirm result. Returns `true` once the server reports `active`,
 * or `false` if it never does within the attempt budget. The caller decides how
 * to present a non-confirmation (e.g. an "awaiting confirmation" message instead
 * of a premature "saved").
 */
export async function waitForAutoRechargeActivation({
  refresh,
  getStatus,
  attempts = 5,
  delayMs = 800,
  sleep = defaultSleep,
}: ActivationPollOptions): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    await refresh(true)
    if (getStatus() === 'active') return true
    if (attempt < attempts - 1) await sleep(delayMs)
  }
  return getStatus() === 'active'
}
