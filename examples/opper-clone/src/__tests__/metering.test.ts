import { beforeEach, describe, expect, it } from 'vitest'
import { amountToSettle, createMetering, usdString, type Metering } from '../agent-layer/metering'
import { FakeSolvaPayApi } from './fakes'

const PRINCIPAL = 'ppl_ABCDEFGHIJKLMNOP'
const CUSTOMER = 'cus_TESTCUST'

function call() {
  return new Request('http://clone.test/v3/compat/v1/messages', { method: 'POST' })
}

describe('metering', () => {
  let api: FakeSolvaPayApi
  let metering: Metering

  beforeEach(() => {
    api = new FakeSolvaPayApi()
    metering = createMetering({ solvaPay: api.solvaPay(), productRef: 'prd_TEST' })
  })

  function open(estimateUsd = '0.50', metadata?: Record<string, string>) {
    return metering.open({ request: call(), customerRef: CUSTOMER, estimateUsd, metadata })
  }

  async function allowed(estimateUsd = '0.50', metadata?: Record<string, string>) {
    const opened = await open(estimateUsd, metadata)
    if (opened.kind !== 'allow') throw new Error(`expected allow, got ${opened.reason}`)
    return opened
  }

  it('finds the customer by principal', async () => {
    expect(await metering.customer(PRINCIPAL)).toBe(CUSTOMER)
    expect(api.lookups).toEqual([PRINCIPAL])
  })

  it('looks the customer up once per principal', async () => {
    await metering.customer(PRINCIPAL)
    await metering.customer(PRINCIPAL)
    expect(api.lookups).toHaveLength(1)
  })

  it('answers null for an unlinked principal, asks again next time, and never creates a customer', async () => {
    expect(await metering.customer('ppl_UNLINKEDUNLINKED')).toBeNull()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(await metering.customer('ppl_UNLINKEDUNLINKED')).toBeNull()
    expect(api.lookups).toEqual(['ppl_UNLINKEDUNLINKED', 'ppl_UNLINKEDUNLINKED'])
    expect(api.usages).toHaveLength(0)
  })

  it("refuses topup_required with the gate's message when the balance is below this call's estimate", async () => {
    api.credits = 4_999
    const opened = await open('0.50')
    expect(opened).toMatchObject({ kind: 'refused', reason: 'topup_required' })
    if (opened.kind !== 'refused') return
    expect(opened.message).toMatch(/0\.4999 USD is below the 0\.5 USD/)
  })

  it('allows the same balance for a smaller estimate', async () => {
    api.credits = 4_999
    expect((await allowed('0.0912')).kind).toBe('allow')
  })

  it("settles at the stream's cost, with the decision on the usage row", async () => {
    const opened = await allowed('0.50', { decision_ref: 'dec_TEST0001' })
    const settled = await opened.settle({ status: 200, costUsd: 0.000043 })
    expect(settled).toMatchObject({ settled: true, source: 'reported', amountUsd: '0.000043' })
    expect(api.usages[0].cost).toEqual({ amount: '0.000043', currency: 'USD', source: 'reported' })
    expect(api.usages[0].metadata).toMatchObject({ decision_ref: 'dec_TEST0001' })
  })

  it('settles a stream cut after the cost was read at that cost', async () => {
    const opened = await allowed()
    await opened.settle({ status: 200, costUsd: 0.2956, interrupted: 'client disconnected' })
    expect(api.usages[0]).toMatchObject({
      outcome: 'fail',
      cost: { amount: '0.2956', source: 'reported' },
      metadata: { interrupted: 'client disconnected' },
    })
  })

  it("settles provisionally at this call's estimate when the upstream answered without a cost", async () => {
    const opened = await allowed('0.0912')
    const settled = await opened.settle({ status: 200, costUsd: null })
    expect(settled).toMatchObject({ settled: true, source: 'provisional', amountUsd: '0.0912' })
    expect(api.usages[0].cost).toEqual({ amount: '0.0912', currency: 'USD', source: 'provisional' })
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
    expect((await open()).kind).toBe('refused')
  })
})

describe('amountToSettle', () => {
  it('takes the reported cost, else the estimate as provisional, and nothing after an error', () => {
    expect(amountToSettle({ status: 200, costUsd: 0.000043 }, '0.09')).toEqual({
      source: 'reported',
      amountUsd: '0.000043',
    })
    expect(amountToSettle({ status: 200, costUsd: null }, '0.09')).toEqual({
      source: 'provisional',
      amountUsd: '0.09',
    })
    expect(amountToSettle({ status: 500, costUsd: 0.1 }, '0.09')).toBeNull()
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
