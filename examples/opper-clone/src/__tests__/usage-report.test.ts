import { describe, expect, it } from 'vitest'
import type { UsageRow } from '../merchant/opper-client'
import { buildUsageReport, roundToPlaces, unitsToUsd } from '../merchant/usage-report'

const PROJECT = 'uuid-sp-alice'
const WINDOW = { from: '2026-09-01T00:00:00Z', to: '2026-10-10T11:45:00Z' }

function row(
  timeBucket: string,
  cost: string,
  decisionId: string | null,
  projectUuid: string | null = PROJECT,
): UsageRow {
  return { timeBucket, cost, groups: { project_uuid: projectUuid, decision_id: decisionId } }
}

function build(rows: UsageRow[], window = WINDOW) {
  return buildUsageReport({
    userRef: 'ppl_3J5DQOPECSRULKFW',
    customerRef: 'cus_TESTCUST',
    projectUuid: PROJECT,
    window,
    rows,
  })
}

function usd(...values: string[]): string {
  return unitsToUsd(roundToPlaces(values))
}

describe('rounding', () => {
  it.each([
    ['0.006261200000000001', '0.0062612'],
    ['4.059175457000000100420', '4.05917546'],
    ['0.123456785', '0.12345679'],
    ['0.123456784999999', '0.12345678'],
    ['0.000000005', '0.00000001'],
    ['0.000000004999', '0'],
    ['0.07481650', '0.0748165'],
    ['12', '12'],
    ['0', '0'],
  ])('rounds %s half-up to %s', (value, expected) => {
    expect(usd(value)).toBe(expected)
  })

  it('sums exactly before rounding once', () => {
    expect(usd('0.1000000025', '0.2000000025')).toBe('0.30000001')
    expect(usd('0.1', '0.2')).toBe('0.3')
  })

  it.each(['1e-7', '-0.1', '0.1.2', '', ' 0.1'])('refuses %j', value => {
    expect(() => roundToPlaces([value])).toThrow(/is not a decimal/)
  })
})

describe('buildUsageReport', () => {
  it('keeps the user project only, drops zero rows and sums each decision across buckets', () => {
    const report = build([
      row('2026-10-09T18:00:00Z', '0.006261200000000001', 'dec_A'),
      row('2026-10-09T18:00:00Z', '0.1000000025', 'dec_B'),
      row('2026-10-09T19:00:00Z', '0.2000000025', 'dec_B'),
      row('2026-10-09T18:00:00Z', '9.99', 'dec_OTHER', 'uuid-sp-bob'),
      row('2026-10-09T18:00:00Z', '1.5', null, 'uuid-sp-bob'),
      row('2026-10-09T18:00:00Z', '0.25', null, null),
      row('2026-10-09T20:00:00Z', '0', null),
      row('2026-10-09T20:00:00Z', '0.000000004', 'dec_C'),
      row('2026-10-31T00:00:00Z', '0', null, null),
    ])
    expect(report).toEqual({
      reportId: 'ppl_3J5DQOPECSRULKFW:2026-09-01T00:00:00Z:2026-10-10T11:45:00Z',
      customerRef: 'cus_TESTCUST',
      source: 'opper:/v2/analytics/usage',
      window: WINDOW,
      calls: [
        { decisionRef: 'dec_A', costUsd: '0.0062612' },
        { decisionRef: 'dec_B', costUsd: '0.30000001' },
      ],
      untagged: [],
    })
  })

  it('keeps untagged hour buckets that start inside the window, oldest first', () => {
    const report = build([
      row('2026-10-10T11:00:00Z', '0.04', null),
      row('2026-08-31T23:00:00Z', '0.5', null),
      row('2026-09-01T00:00:00Z', '0.0830027', null),
      row('2026-10-10T11:45:00Z', '0.07', null),
      row('2026-10-10T12:00:00Z', '0.08', null),
    ])
    expect(report.untagged).toEqual([
      { at: '2026-09-01T00:00:00.000Z', costUsd: '0.0830027' },
      { at: '2026-10-10T11:00:00.000Z', costUsd: '0.04' },
    ])
  })

  it('reports decisions outside the window too; SolvaPay ignores them', () => {
    const report = build([row('2026-10-10T12:00:00Z', '0.01', 'dec_LATE')])
    expect(report.calls).toEqual([{ decisionRef: 'dec_LATE', costUsd: '0.01' }])
  })

  it('refuses a time bucket without a zone, which would read as local time', () => {
    expect(() => build([row('2026-10-10T11:00:00', '0.04', null)])).toThrow(/with a zone/)
  })

  it('refuses rows not grouped by project and decision', () => {
    const rows = [{ timeBucket: '2026-10-10T11:00:00Z', cost: '0.1', groups: { decision_id: 'x' } }]
    expect(() => build(rows)).toThrow(/not grouped by project_uuid/)
  })

  it('refuses a report id over 128 characters or with other characters', () => {
    const long = { from: WINDOW.from, to: `${'9'.repeat(100)}Z` }
    expect(() => build([], long)).toThrow(/over 128 characters/)
    expect(() =>
      buildUsageReport({
        userRef: 'alice smith',
        customerRef: 'cus_TESTCUST',
        projectUuid: PROJECT,
        window: WINDOW,
        rows: [],
      }),
    ).toThrow(/outside \[A-Za-z0-9_:.-\]/)
  })
})
