import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createSolvaPay } from '../src'
import type { SolvaPayClient } from '../src/types'

// Reuse the mock client shape from paywall.unit.test.ts at a smaller
// surface so the gate-specific assertions stay focused.
class GateMockClient implements SolvaPayClient {
  public shouldBlock = false
  public trackUsageCalls: any[] = []
  public createdCustomers: any[] = []

  async checkLimits(_params: { customerRef: string; productRef: string }) {
    if (this.shouldBlock) {
      return {
        withinLimits: false,
        remaining: 0,
        plan: 'free',
        checkoutUrl: 'https://example.com/checkout',
        product: { name: 'Demo', ref: _params.productRef, provider: 'acme' },
      } as any
    }
    return {
      withinLimits: true,
      remaining: 99,
      plan: 'free',
    } as any
  }

  async trackUsage(params: any) {
    this.trackUsageCalls.push(params)
  }

  async createCustomer(params: any) {
    const ref = `cus_${(params.externalRef ?? params.email ?? 'auto').replace(/[^a-z0-9_]/gi, '_')}`
    this.createdCustomers.push(params)
    return { customerRef: ref } as any
  }

  async getCustomer(params: any) {
    const ref = params.customerRef ?? params.externalRef ?? params.email
    if (!ref) throw new Error('404 - Customer not found')
    return { customerRef: ref.startsWith('cus_') ? ref : `cus_${ref}` } as any
  }
}

describe('payable.gate()', () => {
  let client: GateMockClient
  let solvaPay: ReturnType<typeof createSolvaPay>

  beforeEach(() => {
    client = new GateMockClient()
    solvaPay = createSolvaPay({ apiClient: client as any })
  })

  describe('paywall outcome', () => {
    beforeEach(() => {
      client.shouldBlock = true
    })

    it('returns kind: paywall with a 402 Response', async () => {
      const payable = solvaPay.payable({ productRef: 'prd_chat' })
      const req = new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'x-customer-ref': 'anon_abc' },
      })

      const result = await payable.gate(req)
      expect(result.kind).toBe('paywall')
      if (result.kind !== 'paywall') return
      expect(result.response.status).toBe(402)
      expect(result.response.headers.get('content-type')).toMatch(/application\/json/)
      const body = await result.response.json()
      expect(body).toMatchObject({
        success: false,
        kind: 'payment_required',
        product: 'prd_chat',
        checkoutUrl: 'https://example.com/checkout',
      })
    })

    it('exposes the structured paywall content alongside the prebuilt response', async () => {
      const payable = solvaPay.payable({ productRef: 'prd_chat' })
      const req = new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'x-customer-ref': 'anon_abc' },
      })

      const result = await payable.gate(req)
      if (result.kind !== 'paywall') throw new Error('expected paywall')
      expect(result.content.kind).toBe('payment_required')
      expect(result.content.product).toBe('prd_chat')
      expect(result.content.checkoutUrl).toBe('https://example.com/checkout')
      expect(result.content.message).toMatch(/upgrade/i)
    })

    it('emits a paywall trackUsage event (mirrors handler-shaped adapters)', async () => {
      const payable = solvaPay.payable({ productRef: 'prd_chat' })
      const req = new Request('http://localhost/api/chat', {
        headers: { 'x-customer-ref': 'anon_abc' },
      })
      await payable.gate(req)
      expect(client.trackUsageCalls).toHaveLength(1)
      expect(client.trackUsageCalls[0]).toMatchObject({
        outcome: 'paywall',
        productRef: 'prd_chat',
      })
    })
  })

  describe('allow outcome', () => {
    it('returns kind: allow with the decision + bound trackSuccess/trackFail', async () => {
      const payable = solvaPay.payable({ productRef: 'prd_chat' })
      const req = new Request('http://localhost/api/chat', {
        headers: { 'x-customer-ref': 'anon_xyz' },
      })

      const result = await payable.gate(req)
      expect(result.kind).toBe('allow')
      if (result.kind !== 'allow') return
      expect(result.customerRef).toBe('cus_anon_xyz')
      expect(result.decision.outcome).toBe('allow')
      expect(typeof result.trackSuccess).toBe('function')
      expect(typeof result.trackFail).toBe('function')
    })

    it('does NOT emit trackUsage on allow until trackSuccess is called', async () => {
      const payable = solvaPay.payable({ productRef: 'prd_chat' })
      const req = new Request('http://localhost/api/chat', {
        headers: { 'x-customer-ref': 'anon_xyz' },
      })
      await payable.gate(req)
      expect(client.trackUsageCalls).toHaveLength(0)
    })

    it('trackSuccess emits a success usage event with productRef + customerRef bound', async () => {
      const payable = solvaPay.payable({ productRef: 'prd_chat' })
      const req = new Request('http://localhost/api/chat', {
        headers: { 'x-customer-ref': 'anon_xyz' },
      })
      const result = await payable.gate(req)
      if (result.kind !== 'allow') throw new Error('expected allow')

      result.trackSuccess({ duration: 123, metadata: { inputTokens: 5, outputTokens: 10 } })
      // trackUsage is async; wait one microtask flush.
      await Promise.resolve()
      await Promise.resolve()

      expect(client.trackUsageCalls).toHaveLength(1)
      expect(client.trackUsageCalls[0]).toMatchObject({
        outcome: 'success',
        productRef: 'prd_chat',
        customerRef: 'cus_anon_xyz',
        duration: 123,
        metadata: expect.objectContaining({ inputTokens: 5, outputTokens: 10 }),
      })
    })

    it('trackFail emits a fail usage event', async () => {
      const payable = solvaPay.payable({ productRef: 'prd_chat' })
      const req = new Request('http://localhost/api/chat', {
        headers: { 'x-customer-ref': 'anon_xyz' },
      })
      const result = await payable.gate(req)
      if (result.kind !== 'allow') throw new Error('expected allow')

      result.trackFail(new Error('boom'), { duration: 50 })
      await Promise.resolve()
      await Promise.resolve()

      expect(client.trackUsageCalls).toHaveLength(1)
      expect(client.trackUsageCalls[0]).toMatchObject({
        outcome: 'fail',
        productRef: 'prd_chat',
        customerRef: 'cus_anon_xyz',
        duration: 50,
      })
    })

    it('allows multiple trackSuccess calls for per-step metering', async () => {
      const payable = solvaPay.payable({ productRef: 'prd_chat' })
      const req = new Request('http://localhost/api/chat', {
        headers: { 'x-customer-ref': 'anon_xyz' },
      })
      const result = await payable.gate(req)
      if (result.kind !== 'allow') throw new Error('expected allow')

      result.trackSuccess({ metadata: { stepType: 'tool-call' } })
      result.trackSuccess({ metadata: { stepType: 'final' } })
      await Promise.resolve()
      await Promise.resolve()

      expect(client.trackUsageCalls).toHaveLength(2)
      expect(client.trackUsageCalls[0]).toMatchObject({ outcome: 'success' })
      expect(client.trackUsageCalls[1]).toMatchObject({ outcome: 'success' })
    })

    it('routes track promises through ctx.waitUntil when ctx is provided', async () => {
      const waitUntil = vi.fn()
      const payable = solvaPay.payable({ productRef: 'prd_chat' })
      const req = new Request('http://localhost/api/chat', {
        headers: { 'x-customer-ref': 'anon_xyz' },
      })
      const result = await payable.gate(req, { ctx: { waitUntil } })
      if (result.kind !== 'allow') throw new Error('expected allow')

      result.trackSuccess()
      expect(waitUntil).toHaveBeenCalledTimes(1)
      expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise))
    })
  })

  describe('customer ref resolution', () => {
    it('uses getCustomerRef option when provided (overrides header)', async () => {
      const payable = solvaPay.payable({ productRef: 'prd_chat' })
      const req = new Request('http://localhost/api/chat', {
        headers: { 'x-customer-ref': 'header_ref' },
      })
      const result = await payable.gate(req, {
        getCustomerRef: r => `option_${r.headers.get('x-customer-ref') ?? 'noop'}`,
      })
      if (result.kind !== 'allow') throw new Error('expected allow')
      expect(result.customerRef).toBe('cus_option_header_ref')
    })

    it('supports async getCustomerRef', async () => {
      const payable = solvaPay.payable({ productRef: 'prd_chat' })
      const req = new Request('http://localhost/api/chat')
      const result = await payable.gate(req, {
        getCustomerRef: async () => 'async_user',
      })
      if (result.kind !== 'allow') throw new Error('expected allow')
      expect(result.customerRef).toBe('cus_async_user')
    })

    it('falls back to x-customer-ref header when no option provided', async () => {
      const payable = solvaPay.payable({ productRef: 'prd_chat' })
      const req = new Request('http://localhost/api/chat', {
        headers: { 'x-customer-ref': 'hdr_user' },
      })
      const result = await payable.gate(req)
      if (result.kind !== 'allow') throw new Error('expected allow')
      expect(result.customerRef).toBe('cus_hdr_user')
    })

    it('falls back to "anonymous" when neither option nor header are provided', async () => {
      const payable = solvaPay.payable({ productRef: 'prd_chat' })
      const req = new Request('http://localhost/api/chat')
      const result = await payable.gate(req)
      if (result.kind !== 'allow') throw new Error('expected allow')
      expect(result.customerRef).toBe('anonymous')
    })
  })
})
