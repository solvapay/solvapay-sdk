import { describe, expect, it } from 'vitest'
import { OpperClient, OpperUpstreamError } from '../merchant/opper-client'

function clientReturning(body: unknown, seen: string[] = []) {
  const fetchImpl = (async (url: string | URL) => {
    seen.push(String(url))
    return new Response(JSON.stringify(body), { status: 200 })
  }) as typeof fetch
  return new OpperClient('https://opper.test', 'op-mak-test', fetchImpl)
}

describe('OpperClient.getUsage', () => {
  it('asks for the tag split and keeps untagged rows as null', async () => {
    const seen: string[] = []
    const client = clientReturning(
      [
        { time_bucket: '2026-10-01T00:00:00Z', cost: '0.07481650', decision_id: 'dec_A' },
        { time_bucket: '2026-10-01T00:00:00Z', cost: '0.0012', decision_id: null },
      ],
      seen,
    )
    const rows = await client.getUsage('op-runtime', {
      groupBy: ['decision_id'],
      granularity: 'month',
      from: '2026-10-01T00:00:00Z',
    })
    expect(seen[0]).toBe(
      'https://opper.test/v2/analytics/usage?group_by=decision_id&granularity=month&from_date=2026-10-01T00%3A00%3A00Z',
    )
    expect(rows).toEqual([
      { timeBucket: '2026-10-01T00:00:00Z', cost: '0.07481650', groups: { decision_id: 'dec_A' } },
      { timeBucket: '2026-10-01T00:00:00Z', cost: '0.0012', groups: { decision_id: null } },
    ])
  })

  it('refuses a body that is not a list', async () => {
    const client = clientReturning({ data: [] })
    await expect(
      client.getUsage('op-runtime', { groupBy: ['decision_id'], granularity: 'day' }),
    ).rejects.toBeInstanceOf(OpperUpstreamError)
  })

  it('refuses a row whose cost is missing', async () => {
    const client = clientReturning([{ time_bucket: '2026-10-01T00:00:00Z', decision_id: 'dec_A' }])
    await expect(
      client.getUsage('op-runtime', { groupBy: ['decision_id'], granularity: 'day' }),
    ).rejects.toThrow('usage cost')
  })
})
