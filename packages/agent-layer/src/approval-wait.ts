// Holding an agent's paid call while its owner decides (phone demo, DEV-1104):
// when SolvaPay asks with a pending approval, the call waits on the
// approval's status URL instead of failing, so the agent carries on once the
// owner approves. A sub-module beside `./policy`; at promotion it moves into
// `payable` with the rest of the agent layer.
import type { DecideApproval, SolvaPayAgentClient } from './client'

/** How a hold ended. Only `approved` lets the call be decided again. */
export type WaitOutcome = 'approved' | 'declined' | 'expired' | 'timed_out' | 'client_closed'

export interface WaitResult {
  outcome: WaitOutcome
  waitedMs: number
}

export interface ApprovalWait {
  /** 0 when holding is off: an ask is answered at once, as before. */
  readonly maxMs: number
  /**
   * Polls the approval until it is decided, expires, the hold reaches
   * `maxMs` or the approval's expiry, or the caller goes away. A status read
   * that fails throws: the call is then refused as unavailable, never let
   * through.
   */
  until(approval: DecideApproval, signal: AbortSignal): Promise<WaitResult>
}

export function createApprovalWait(deps: {
  client: Pick<SolvaPayAgentClient, 'approvalStatus'>
  maxSeconds: number
  pollMs: number
  now?: () => number
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
}): ApprovalWait {
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? abortableSleep
  const maxMs = deps.maxSeconds * 1000

  return {
    maxMs,
    async until(approval, signal) {
      const started = now()
      const deadline = Math.min(started + maxMs, Date.parse(approval.expiresAt))
      const result = (outcome: WaitOutcome): WaitResult => ({ outcome, waitedMs: now() - started })

      for (;;) {
        if (signal.aborted) return result('client_closed')
        const { status } = await deps.client.approvalStatus(approval.statusUrl)
        if (status !== 'pending') return result(status)
        const left = deadline - now()
        if (left <= 0) return result('timed_out')
        await sleep(Math.min(deps.pollMs, left), signal)
      }
    },
  }
}

/** Resolves after `ms`, or at once when the caller goes away. */
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
  })
}
