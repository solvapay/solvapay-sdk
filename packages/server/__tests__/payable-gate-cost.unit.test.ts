import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SolvaPayError } from '@solvapay/core'
import { createSolvaPay } from '../src'
import type { SolvaPayClient, TrackUsageRequest, TrackUsageResponse } from '../src/types'

const CUSTOMER = 'cus_32JJYPYW'

function costDebit(balanceUsd: string, amountUsd = '0.000043'): TrackUsageResponse {
  return {
    success: true,
    reference: 'usage_TEST',
    creditDebit: {
      debited: true,
      costSource: 'reported',
      amount: 0,
      amountUsd,
      balanceCredits: 30_000,
      balanceUsd,
    },
  }
}

class CostMockClient implements SolvaPayClient {
  credits = 30_000
  balanceReads = 0
  checkLimitsCalls = 0
  createCustomerCalls = 0
  trackUsageCalls: TrackUsageRequest[] = []
  trackUsageReply: (params: TrackUsageRequest) => Promise<TrackUsageResponse> = async () =>
    costDebit('2.999957')

  async checkLimits(): Promise<never> {
    this.checkLimitsCalls++
    throw new Error('cost mode must not call /limits')
  }

  async trackUsage(params: TrackUsageRequest) {
    this.trackUsageCalls.push(params)
    return this.trackUsageReply(params)
  }

  async createCustomer(): Promise<never> {
    this.createCustomerCalls++
    throw new Error('cost mode must not create customers')
  }

  async getCustomerBalance(params: { customerRef: string }) {
    this.balanceReads++
    return {
      customerRef: params.customerRef,
      credits: this.credits,
      creditsPerMinorUnit: 100,
      displayCurrency: 'USD',
      displayExchangeRate: 1,
      display: {
        amountMajor: this.credits / 10_000,
        currency: 'USD',
        exchangeRate: 1,
        formatted: '',
        rateSource: 'parity' as const,
      },
    }
  }

  createCheckoutSession(): Promise<never> {
    throw new Error('not used')
  }

  createCustomerSession(): Promise<never> {
    throw new Error('not used')
  }
}

function request(customerRef = CUSTOMER) {
  return new Request('http://localhost/v1/messages', {
    method: 'POST',
    headers: { 'x-customer-ref': customerRef },
  })
}

const COST = { estimateUsd: '0.50' }

describe('payable.gate() in cost mode', () => {
  let client: CostMockClient
  let payable: ReturnType<ReturnType<typeof createSolvaPay>['payable']>

  beforeEach(() => {
    client = new CostMockClient()
    payable = createSolvaPay({ apiClient: client }).payable({ productRef: 'prd_NAV0KNC0' })
  })

  async function allow(customerRef = CUSTOMER) {
    const result = await payable.gate(request(customerRef), { cost: COST })
    if (result.kind !== 'allow') throw new Error('expected allow')
    return result
  }

  describe('gate', () => {
    it('should not call /limits or create a customer', async () => {
      await allow()
      expect(client.checkLimitsCalls).toBe(0)
      expect(client.createCustomerCalls).toBe(0)
    })

    it('should allow while the balance covers the estimate', async () => {
      const result = await allow()
      expect(result.customerRef).toBe(CUSTOMER)
      expect(result.balanceUsd).toBe('3')
    })

    it('should allow when the balance equals the estimate', async () => {
      client.credits = 5_000
      const result = await payable.gate(request(), { cost: COST })
      expect(result.kind).toBe('allow')
    })

    it('should read the balance once per customer', async () => {
      await allow()
      await allow()
      expect(client.balanceReads).toBe(1)
    })

    it('should share one balance read between concurrent first calls', async () => {
      await Promise.all([allow(), allow(), allow()])
      expect(client.balanceReads).toBe(1)
    })

    it('should return a 402 topup_required below the estimate', async () => {
      client.credits = 4_999
      const result = await payable.gate(request(), { cost: COST })
      if (result.kind !== 'paywall') throw new Error('expected paywall')
      expect(result.response.status).toBe(402)
      expect(result.content).toMatchObject({
        kind: 'payment_required',
        product: 'prd_NAV0KNC0',
        reason: 'topup_required',
        nextAction: 'topup',
      })
      expect(result.content.message).toContain('0.4999 USD')
      const body = await result.response.json()
      expect(body).toMatchObject({ success: false, kind: 'payment_required' })
    })

    it('should not record a usage event when it returns a 402', async () => {
      client.credits = 0
      await payable.gate(request(), { cost: COST })
      expect(client.trackUsageCalls).toHaveLength(0)
    })

    it('should require a SolvaPay customer reference', async () => {
      await expect(payable.gate(request('ppl_3J5DQOPECSRULKFW'), { cost: COST })).rejects.toThrow(
        SolvaPayError,
      )
    })

    it('should reject an estimate that is not a USD decimal string', async () => {
      await expect(payable.gate(request(), { cost: { estimateUsd: '0.5e-3' } })).rejects.toThrow(
        /estimateUsd/,
      )
    })
  })

  describe('settle', () => {
    it('should send the cost on one usage event with an idempotency key', async () => {
      const result = await allow()
      await result.settle({ amountUsd: '0.000043', source: 'reported', duration: 812 })
      expect(client.trackUsageCalls).toHaveLength(1)
      expect(client.trackUsageCalls[0]).toMatchObject({
        customerRef: CUSTOMER,
        productRef: 'prd_NAV0KNC0',
        actionType: 'api_call',
        units: 1,
        outcome: 'success',
        duration: 812,
        idempotencyKey: `${result.requestId}:cost`,
        cost: { amount: '0.000043', currency: 'USD', source: 'reported' },
      })
    })

    it('should pass a failed outcome and metadata through', async () => {
      const result = await allow()
      await result.settle({
        amountUsd: '0.50',
        source: 'provisional',
        outcome: 'fail',
        metadata: { traceId: 't1' },
      })
      expect(client.trackUsageCalls[0]).toMatchObject({
        outcome: 'fail',
        cost: { amount: '0.50', source: 'provisional' },
        metadata: { requestId: result.requestId, traceId: 't1' },
      })
    })

    it('should return the debit', async () => {
      const result = await allow()
      const debit = await result.settle({ amountUsd: '0.000043', source: 'reported' })
      expect(debit).toEqual({
        debited: true,
        costSource: 'reported',
        amount: 0,
        amountUsd: '0.000043',
        balanceCredits: 30_000,
        balanceUsd: '2.999957',
      })
    })

    it('should gate the next call on the balance the debit returned', async () => {
      client.trackUsageReply = async () => costDebit('0.4999')
      const first = await allow()
      await first.settle({ amountUsd: '2.5001', source: 'reported' })
      const next = await payable.gate(request(), { cost: COST })
      expect(next.kind).toBe('paywall')
      expect(client.balanceReads).toBe(1)
    })

    it('should send one customer’s settles one at a time', async () => {
      let release: () => void = () => undefined
      client.trackUsageReply = () =>
        new Promise(resolve => {
          release = () => resolve(costDebit('2.99'))
        })
      const a = await allow()
      const b = await allow()
      const first = a.settle({ amountUsd: '0.01', source: 'reported' })
      const second = b.settle({ amountUsd: '0.01', source: 'reported' })
      await vi.waitFor(() => expect(client.trackUsageCalls).toHaveLength(1))
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(client.trackUsageCalls).toHaveLength(1)
      release()
      await first
      await vi.waitFor(() => expect(client.trackUsageCalls).toHaveLength(2))
      release()
      await second
    })

    it('should settle a call only once', async () => {
      const result = await allow()
      await result.settle({ amountUsd: '0.01', source: 'reported' })
      await expect(result.settle({ amountUsd: '0.50', source: 'provisional' })).rejects.toThrow(
        /already settled/,
      )
      expect(client.trackUsageCalls).toHaveLength(1)
    })

    it('should reject an amount that is not a USD decimal string', async () => {
      const result = await allow()
      await expect(result.settle({ amountUsd: '-0.01', source: 'reported' })).rejects.toThrow(
        /amountUsd/,
      )
      expect(client.trackUsageCalls).toHaveLength(0)
    })

    it('should pass a skipped debit through', async () => {
      client.trackUsageReply = async () => ({
        success: true,
        reference: 'usage_TEST',
        creditDebit: { debited: false, reason: 'duplicate' },
      })
      const result = await allow()
      const debit = await result.settle({ amountUsd: '0.01', source: 'reported' })
      expect(debit).toEqual({ debited: false, reason: 'duplicate' })
    })

    it('should report a server that ignored the cost as not debited by cost', async () => {
      client.trackUsageReply = async () => ({
        success: true,
        reference: 'usage_TEST',
        creditDebit: { debited: true, amount: 1, remainingUnits: 29_999, unitsRemaining: 29_999 },
      })
      const result = await allow()
      const debit = await result.settle({ amountUsd: '0.01', source: 'reported' })
      expect(debit).toEqual({ debited: false, reason: 'cost_not_supported' })
    })

    it('should read the balance again after a failed settle', async () => {
      client.trackUsageReply = async () => {
        throw new SolvaPayError('Track usage failed', { status: 503 })
      }
      const result = await allow()
      await expect(result.settle({ amountUsd: '0.01', source: 'reported' })).rejects.toThrow(
        SolvaPayError,
      )
      await allow()
      expect(client.balanceReads).toBe(2)
    })

    it('should keep a Workers request alive until the settle finishes', async () => {
      const waitUntil = vi.fn()
      const result = await payable.gate(request(), { cost: COST, ctx: { waitUntil } })
      if (result.kind !== 'allow') throw new Error('expected allow')
      await result.settle({ amountUsd: '0.01', source: 'reported' })
      expect(waitUntil).toHaveBeenCalledTimes(1)
    })
  })
})
