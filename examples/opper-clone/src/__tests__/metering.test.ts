import { beforeEach, describe, expect, it } from 'vitest'
import { createMetering, usdString, type Metering } from '../agent-layer/metering'
import { FakeSolvaPayApi } from './fakes'

const PRINCIPAL = 'ppl_ABCDEFGHIJKLMNOP'

function call() {
  return new Request('http://clone.test/v3/compat/v1/messages', { method: 'POST' })
}

describe('metering', () => {
  let api: FakeSolvaPayApi
  let metering: Metering

  beforeEach(() => {
    api = new FakeSolvaPayApi()
    metering = createMetering({
      solvaPay: api.solvaPay(),
      productRef: 'prd_TEST',
      estimateUsd: '0.50',
    })
  })

  async function allowed() {
    const opened = await metering.open({ request: call(), principalRef: PRINCIPAL })
    if (opened.kind !== 'allow') throw new Error(`expected allow, got ${opened.reason}`)
    return opened
  }

  it('finds the customer by principal and allows a covered call', async () => {
    const opened = await allowed()
    expect(opened.customerRef).toBe('cus_TESTCUST')
    expect(api.lookups).toEqual([PRINCIPAL])
  })

  it('looks the customer up once per principal', async () => {
    await allowed()
    await allowed()
    expect(api.lookups).toHaveLength(1)
  })

  it('refuses an unlinked principal with a 402 and never creates a customer', async () => {
    const opened = await metering.open({ request: call(), principalRef: 'ppl_UNLINKEDUNLINKED' })
    expect(opened.kind).toBe('refused')
    if (opened.kind !== 'refused') return
    expect(opened.reason).toBe('customer_not_linked')
    expect(opened.response.status).toBe(402)
    expect(api.usages).toHaveLength(0)
  })

  it('refuses with a 402 topup_required when the balance is below the estimate', async () => {
    api.credits = 4_999
    const opened = await metering.open({ request: call(), principalRef: PRINCIPAL })
    expect(opened.kind).toBe('refused')
    if (opened.kind !== 'refused') return
    expect(opened.reason).toBe('topup_required')
    expect(opened.response.status).toBe(402)
  })

  it("settles at the stream's cost", async () => {
    const opened = await allowed()
    const settled = await opened.settle({ status: 200, costUsd: 0.000043 })
    expect(settled).toMatchObject({ settled: true, source: 'reported', amountUsd: '0.000043' })
    expect(api.usages[0].cost).toEqual({ amount: '0.000043', currency: 'USD', source: 'reported' })
  })

  it('settles a stream cut after the cost was read at that cost', async () => {
    const opened = await allowed()
    await opened.settle({ status: 200, costUsd: 0.2956, interrupted: 'client disconnected' })
    expect(api.usages[0]).toMatchObject({
      outcome: 'fail',
      cost: { amount: '0.2956', source: 'reported' },
    })
  })

  it('settles provisionally at the estimate when the upstream answered without a cost', async () => {
    const opened = await allowed()
    const settled = await opened.settle({ status: 200, costUsd: null })
    expect(settled).toMatchObject({ settled: true, source: 'provisional', amountUsd: '0.50' })
    expect(api.usages[0].cost).toEqual({ amount: '0.50', currency: 'USD', source: 'provisional' })
  })

  it('does not settle when the upstream answered with an error', async () => {
    const opened = await allowed()
    expect(await opened.settle({ status: 529, costUsd: null })).toEqual({
      settled: false,
      reason: 'upstream_error',
    })
    expect(await (await allowed()).settle({ status: 400, costUsd: null })).toEqual({
      settled: false,
      reason: 'upstream_error',
    })
    expect(api.usages).toHaveLength(0)
  })

  it('gates the next call on the balance the settle returned', async () => {
    api.balanceUsd = '0.4'
    const opened = await allowed()
    await opened.settle({ status: 200, costUsd: 2.6 })
    const next = await metering.open({ request: call(), principalRef: PRINCIPAL })
    expect(next.kind).toBe('refused')
  })
})

describe('usdString', () => {
  it('writes a cost with up to 8 places and no trailing zeros', () => {
    expect(usdString(0.000043)).toBe('0.000043')
    expect(usdString(0.2956)).toBe('0.2956')
    expect(usdString(1)).toBe('1')
    expect(usdString(0.000000004)).toBe('0')
  })
})
