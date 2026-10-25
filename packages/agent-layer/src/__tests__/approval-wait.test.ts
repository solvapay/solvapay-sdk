import { describe, expect, it } from 'vitest'
import { createApprovalWait } from '../approval-wait'
import type { ApprovalStatus } from '../client'

const STATUS_URL = 'https://api.solvapay.test/v1/sdk/agent/approvals/apr_TEST0001'

/** A clock the fake sleep moves, so the deadlines are exact. */
function harness(statuses: ApprovalStatus[], opts: { maxSeconds: number; expiresInMs?: number }) {
  let clock = 1_000_000
  const reads: number[] = []
  const wait = createApprovalWait({
    client: {
      async approvalStatus() {
        reads.push(clock)
        const status = statuses[Math.min(reads.length, statuses.length) - 1]
        return { reference: 'apr_TEST0001', status, expiresAt: '' }
      },
    },
    maxSeconds: opts.maxSeconds,
    pollMs: 2_000,
    now: () => clock,
    sleep: async ms => {
      clock += ms
    },
  })
  const approval = {
    reference: 'apr_TEST0001',
    status: 'pending' as const,
    statusUrl: STATUS_URL,
    expiresAt: new Date(clock + (opts.expiresInMs ?? 15 * 60_000)).toISOString(),
  }
  return { wait, approval, reads }
}

describe('createApprovalWait', () => {
  it.each(['approved', 'declined', 'expired'] as const)(
    'returns %s as soon as the status says so',
    async status => {
      const { wait, approval, reads } = harness(['pending', 'pending', status], { maxSeconds: 300 })
      await expect(wait.until(approval, new AbortController().signal)).resolves.toEqual({
        outcome: status,
        waitedMs: 4_000,
      })
      expect(reads).toHaveLength(3)
    },
  )

  it('times out at maxSeconds, reading once more at the deadline', async () => {
    const { wait, approval, reads } = harness(['pending'], { maxSeconds: 5 })
    await expect(wait.until(approval, new AbortController().signal)).resolves.toEqual({
      outcome: 'timed_out',
      waitedMs: 5_000,
    })
    expect(reads.map(at => at - reads[0])).toEqual([0, 2_000, 4_000, 5_000])
  })

  it("stops at the approval's own expiry when it comes first, and reports what SolvaPay says then", async () => {
    const { wait, approval, reads } = harness(['pending', 'pending', 'expired'], {
      maxSeconds: 300,
      expiresInMs: 3_000,
    })
    await expect(wait.until(approval, new AbortController().signal)).resolves.toEqual({
      outcome: 'expired',
      waitedMs: 3_000,
    })
    expect(reads.map(at => at - reads[0])).toEqual([0, 2_000, 3_000])
  })

  it('stops when the caller goes away, without another read', async () => {
    const { wait, approval, reads } = harness(['pending'], { maxSeconds: 300 })
    const caller = new AbortController()
    caller.abort()
    await expect(wait.until(approval, caller.signal)).resolves.toMatchObject({
      outcome: 'client_closed',
    })
    expect(reads).toHaveLength(0)
  })

  it('throws when the status cannot be read', async () => {
    const wait = createApprovalWait({
      client: {
        approvalStatus: async () => {
          throw new Error('GET failed (500)')
        },
      },
      maxSeconds: 300,
      pollMs: 2_000,
    })
    await expect(
      wait.until(
        {
          reference: 'apr_TEST0001',
          status: 'pending',
          statusUrl: STATUS_URL,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow('GET failed (500)')
  })
})
