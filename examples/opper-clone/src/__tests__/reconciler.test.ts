import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UsageReportResponse } from '../agent-layer/client'
import { importEncryptionKey } from '../lib/crypto'
import { MemoryKvStore } from '../lib/kv-store'
import type { Logger } from '../log'
import { OpperAccounts } from '../merchant/opper-accounts'
import type { UsageRow } from '../merchant/opper-client'
import { createReconciler, reconcileWindow } from '../merchant/reconciler'
import { FakeAgentApi, FakeOpperManagement, FakeSolvaPayApi, TEST_ENCRYPTION_KEY } from './fakes'

const ALICE = 'ppl_ABCDEFGHIJKLMNOP'
const BOB = 'ppl_BOBBOBBOBBOBBOBB'
const NOW = new Date('2026-10-10T12:00:00.500Z')

function row(
  timeBucket: string,
  cost: string,
  decisionId: string | null,
  userRef: string,
): UsageRow {
  return {
    timeBucket,
    cost,
    groups: { project_uuid: `uuid-sp-${userRef}`, decision_id: decisionId },
  }
}

const ROWS = [
  row('2026-10-09T18:00:00Z', '0.006261200000000001', 'dec_A', ALICE),
  row('2026-10-09T18:00:00Z', '0.25', 'dec_B', BOB),
  row('2026-10-09T19:00:00Z', '0.0012', null, 'poc-tommy'),
]

async function setup(userRefs: string[] = [ALICE, 'poc-tommy']) {
  const opper = new FakeOpperManagement()
  const store = new MemoryKvStore()
  const accounts = new OpperAccounts(opper, store, await importEncryptionKey(TEST_ENCRYPTION_KEY))
  for (const userRef of userRefs) await accounts.open(userRef)
  const solvaPayApi = new FakeSolvaPayApi()
  solvaPayApi.customers.set(BOB, 'cus_BOB')
  const agentApi = new FakeAgentApi()
  const lines: { level: 'info' | 'error'; event: string; fields?: Record<string, unknown> }[] = []
  const log: Logger = {
    info: (event, fields) => lines.push({ level: 'info', event, fields }),
    error: (event, fields) => lines.push({ level: 'error', event, fields }),
  }
  /** Opper's analytics are organisation-wide: every key reads the same rows. */
  function orgUsage(rows: UsageRow[]) {
    for (const { secret } of opper.keys.values()) opper.usage.set(secret, rows)
  }
  orgUsage(ROWS)
  const reconciler = createReconciler({
    accounts,
    store,
    solvaPay: solvaPayApi.solvaPay(),
    agentClient: agentApi,
    log,
    now: () => NOW,
  })
  return { opper, store, accounts, solvaPayApi, agentApi, lines, orgUsage, reconciler }
}

function flagged(untaggedUsd: string): (report: unknown) => UsageReportResponse {
  return () => ({
    reference: 'urp_TEST0001',
    duplicate: false,
    results: [],
    untagged: { totalUsd: untaggedUsd, beforePolicyUsd: '0', flagged: true },
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('reconcileWindow', () => {
  it('runs from the start of the previous UTC month to 15 minutes ago, to the second', () => {
    expect(reconcileWindow(NOW)).toEqual({
      from: '2026-09-01T00:00:00Z',
      to: '2026-10-10T11:45:00Z',
    })
    expect(reconcileWindow(new Date('2027-01-01T00:10:00Z'))).toEqual({
      from: '2026-12-01T00:00:00Z',
      to: '2026-12-31T23:55:00Z',
    })
  })
})

describe('reconciler', () => {
  it('reports once per account with a customer and skips one without', async () => {
    const { opper, agentApi, lines, reconciler } = await setup()
    const run = await reconciler.runOnce()

    expect(opper.usageQueries).toEqual([
      {
        groupBy: ['project_uuid', 'decision_id'],
        granularity: 'hour',
        from: '2026-09-01T00:00:00Z',
      },
    ])
    expect(agentApi.reports).toEqual([
      {
        reportId: `${ALICE}:2026-09-01T00:00:00Z:2026-10-10T11:45:00Z`,
        customerRef: 'cus_TESTCUST',
        source: 'opper:/v2/analytics/usage',
        window: { from: '2026-09-01T00:00:00Z', to: '2026-10-10T11:45:00Z' },
        calls: [{ decisionRef: 'dec_A', costUsd: '0.0062612' }],
        untagged: [],
      },
    ])
    expect(run.outcomes).toEqual([
      { userRef: 'poc-tommy', status: 'skipped', reason: 'no_customer' },
      expect.objectContaining({
        userRef: ALICE,
        status: 'reported',
        reference: 'urp_TEST0001',
        counts: { matched: 1, adjusted: 0, pending: 0, already_reconciled: 0, ignored: 0 },
        unmatched: [],
        keyRotated: false,
      }),
    ])
    expect(lines.map(line => line.event)).toEqual(['reconcile.skipped', 'reconcile.reported'])
    expect(lines[1].fields).toMatchObject({
      userRef: ALICE,
      results: { matched: 1 },
      untaggedUsd: '0',
      flagged: false,
    })
    expect(opper.calls.filter(call => call.startsWith('deleteKey'))).toEqual([])
  })

  it('runs for one user only when named', async () => {
    const { agentApi, solvaPayApi, reconciler } = await setup([ALICE, BOB])
    const run = await reconciler.runOnce(BOB)
    expect(run.outcomes.map(outcome => outcome.userRef)).toEqual([BOB])
    expect(solvaPayApi.lookups).toEqual([BOB])
    expect(agentApi.reports[0].calls).toEqual([{ decisionRef: 'dec_B', costUsd: '0.25' }])
  })

  it('rotates the key on a flagged report: new key stored, old one revoked', async () => {
    const { opper, accounts, agentApi, lines, orgUsage, reconciler } = await setup([ALICE])
    orgUsage([...ROWS, row('2026-10-10T11:00:00Z', '0.04', null, ALICE)])
    agentApi.respond = flagged('0.04')
    const oldKey = (await accounts.open(ALICE)).runtimeKey

    const run = await reconciler.runOnce()
    expect(run.outcomes[0]).toMatchObject({ status: 'reported', keyRotated: true })
    expect(agentApi.reports[0].untagged).toEqual([
      { at: '2026-10-10T11:00:00.000Z', costUsd: '0.04' },
    ])
    const newKey = (await accounts.open(ALICE)).runtimeKey
    expect(newKey).not.toBe(oldKey)
    expect([...opper.keys.values()].map(key => key.secret)).toEqual([newKey])
    expect(lines.find(line => line.event === 'reconcile.key_rotated')?.fields).toEqual({
      userRef: ALICE,
      oldKeyId: 1,
      newKeyId: 2,
      untaggedThrough: '2026-10-10T11:00:00.000Z',
    })
  })

  it('rotates once per untagged usage, again only for a later bucket', async () => {
    const { opper, agentApi, orgUsage, reconciler } = await setup([ALICE])
    const untagged = row('2026-10-10T10:00:00Z', '0.04', null, ALICE)
    agentApi.respond = flagged('0.04')
    orgUsage([...ROWS, untagged])
    await reconciler.runOnce()

    orgUsage([...ROWS, untagged])
    const repeat = await reconciler.runOnce()
    expect(repeat.outcomes[0]).toMatchObject({ keyRotated: false })
    expect(opper.calls.filter(call => call.startsWith('deleteKey'))).toEqual(['deleteKey 1'])

    orgUsage([...ROWS, untagged, row('2026-10-10T11:00:00Z', '0.01', null, ALICE)])
    const later = await reconciler.runOnce()
    expect(later.outcomes[0]).toMatchObject({ keyRotated: true })
    expect(opper.calls.filter(call => call.startsWith('deleteKey'))).toEqual([
      'deleteKey 1',
      'deleteKey 2',
    ])
  })

  it('keeps the key when the report is not flagged, untagged usage before the policy included', async () => {
    const { opper, agentApi, orgUsage, reconciler } = await setup([ALICE])
    orgUsage([...ROWS, row('2026-10-08T09:00:00Z', '0.55683497', null, ALICE)])
    agentApi.respond = () => ({
      reference: 'urp_TEST0001',
      duplicate: false,
      results: [],
      untagged: { totalUsd: '0.55683497', beforePolicyUsd: '0.55683497', flagged: false },
    })
    const run = await reconciler.runOnce()
    expect(run.outcomes[0]).toMatchObject({ keyRotated: false })
    expect(opper.keys.size).toBe(1)
  })

  it('carries on past a failing user and reports the failure', async () => {
    const { agentApi, solvaPayApi, lines, reconciler } = await setup([
      ALICE,
      BOB,
      'ppl_CAROLCAROLCAROL',
    ])
    solvaPayApi.customers.set('ppl_CAROLCAROLCAROL', 'cus_CAROL')
    const getCustomer = solvaPayApi.getCustomer.bind(solvaPayApi)
    solvaPayApi.getCustomer = async params => {
      if (params.externalRef === ALICE) {
        throw Object.assign(new Error('Get customer failed (500): boom'), { status: 500 })
      }
      return getCustomer(params)
    }
    const respond = agentApi.respond
    agentApi.respond = report => {
      if (report.customerRef === 'cus_BOB') throw new Error('POST failed (422): window')
      return respond(report)
    }

    const run = await reconciler.runOnce()
    expect(run.outcomes.map(outcome => [outcome.userRef, outcome.status])).toEqual([
      [ALICE, 'failed'],
      [BOB, 'failed'],
      ['ppl_CAROLCAROLCAROL', 'reported'],
    ])
    expect(run.outcomes[0]).toMatchObject({ error: expect.stringContaining('(500)') })
    expect(lines.filter(line => line.level === 'error').map(line => line.fields?.userRef)).toEqual([
      ALICE,
      BOB,
    ])
  })

  it('runs on an interval, one run at a time, until stopped', async () => {
    const { agentApi, lines, reconciler } = await setup([ALICE])
    vi.useFakeTimers()
    let release: () => void = () => {}
    const reportUsage = agentApi.reportUsage.bind(agentApi)
    agentApi.reportUsage = async report => {
      await new Promise<void>(resolve => {
        release = resolve
      })
      return reportUsage(report)
    }

    const stop = reconciler.start(60)
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(lines.map(line => line.event)).toEqual(['reconcile.tick_skipped'])
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(agentApi.reports).toHaveLength(1)

    stop()
    await vi.advanceTimersByTimeAsync(3 * 60 * 60_000)
    expect(agentApi.reports).toHaveLength(1)
    expect(() => reconciler.start(0)).toThrow(/at least 1/)
  })
})
