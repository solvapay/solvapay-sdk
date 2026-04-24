import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createSolvaPay, PaywallError } from '../src'
import { SolvaPayPaywall } from '../src/paywall'
import type { SolvaPayClient } from '../src/types'

// Mock API client for testing
class MockApiClient implements SolvaPayClient {
  private limits = new Map<string, { count: number; lastReset: Date }>()
  private userPlans = new Map<string, string>()

  // Test configuration
  public shouldBlock = false
  public trackUsageCalls: any[] = []

  setUserPlan(customerRef: string, plan: string) {
    this.userPlans.set(customerRef, plan)
  }

  async checkLimits(params: { customerRef: string; productRef: string }) {
    const key = `${params.customerRef}-${params.productRef}`
    const now = new Date()
    const bareRef = params.customerRef.startsWith('cus_')
      ? params.customerRef.slice(4)
      : params.customerRef
    const userPlan = this.userPlans.get(params.customerRef) || this.userPlans.get(bareRef) || 'free'

    // Pro/premium users have unlimited access
    if (userPlan === 'pro' || userPlan === 'premium') {
      return {
        withinLimits: true,
        remaining: 999999,
        plan: userPlan,
        checkoutUrl: undefined,
      }
    }

    // For testing purposes, use shouldBlock flag
    if (this.shouldBlock) {
      return {
        withinLimits: false,
        remaining: 0,
        plan: 'free',
        checkoutUrl: 'https://example.com/checkout',
      }
    }

    // Normal free tier logic
    const data = this.limits.get(key) || { count: 0, lastReset: now }
    const freeLimit = 5

    if (data.count < freeLimit) {
      data.count++
      this.limits.set(key, data)
      return {
        withinLimits: true,
        remaining: freeLimit - data.count,
        plan: 'free',
        checkoutUrl: undefined,
      }
    }

    return {
      withinLimits: false,
      remaining: 0,
      plan: 'free',
      checkoutUrl: 'https://example.com/checkout',
    }
  }

  async trackUsage(params: {
    customerRef: string
    actionType?: string
    units?: number
    outcome?: string
    metadata?: Record<string, unknown>
    duration?: number
    timestamp?: string
  }) {
    this.trackUsageCalls.push(params)
  }

  async createCustomer(params: { email: string; name?: string }) {
    return { customerRef: `customer_${params.email.replace(/[^a-zA-Z0-9]/g, '_')}` }
  }

  async getCustomer(params: { customerRef?: string; externalRef?: string; email?: string }) {
    const ref = params.customerRef || params.externalRef || params.email
    if (!ref) throw new Error('404 - Customer not found')
    const plan = this.userPlans.get(ref) || 'free'
    return {
      customerRef: ref.startsWith('cus_') ? ref : `cus_${ref}`,
      email: `${ref}@example.com`,
      name: ref,
      plan,
    }
  }

  resetTracking() {
    this.trackUsageCalls = []
  }
}

describe('Paywall Unit Tests - Mocked Backend', () => {
  let mockApiClient: MockApiClient
  let solvaPay: any

  beforeEach(() => {
    mockApiClient = new MockApiClient()
    solvaPay = createSolvaPay({
      apiClient: mockApiClient,
    })
    mockApiClient.resetTracking()
  })

  describe('Core Paywall Protection Logic', () => {
    it('should allow requests when customer is within usage limits', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true, data: 'test' })
      const payable = solvaPay.payable({ product: 'test' })
      const protectedHandler = await payable.function(handler)

      const result = await protectedHandler({ auth: { customer_ref: 'test_user' } })

      expect(result).toEqual({ success: true, data: 'test' })
      expect(handler).toHaveBeenCalledOnce()
      expect(mockApiClient.trackUsageCalls).toHaveLength(1)
      expect(mockApiClient.trackUsageCalls[0].outcome).toBe('success')
    })

    it('should throw PaywallError when customer exceeds usage limits', async () => {
      mockApiClient.shouldBlock = true
      const handler = vi.fn()
      const payable = solvaPay.payable({ product: 'test' })
      const protectedHandler = await payable.function(handler)

      await expect(protectedHandler({ auth: { customer_ref: 'blocked_user' } })).rejects.toThrow(
        PaywallError,
      )

      expect(handler).not.toHaveBeenCalled()
      expect(mockApiClient.trackUsageCalls).toHaveLength(1)
      expect(mockApiClient.trackUsageCalls[0].outcome).toBe('paywall')
    })

    it('produces an actionable payment_required message (no raw "Remaining: 0")', async () => {
      mockApiClient.shouldBlock = true
      const handler = vi.fn()
      const payable = solvaPay.payable({ product: 'test' })
      const protectedHandler = await payable.function(handler)

      let captured: PaywallError | null = null
      try {
        await protectedHandler({ auth: { customer_ref: 'blocked_user' } })
      } catch (err) {
        captured = err as PaywallError
      }
      expect(captured).toBeInstanceOf(PaywallError)
      const sc = captured!.structuredContent
      expect(sc.kind).toBe('payment_required')
      expect(sc.message).not.toMatch(/Remaining:\s*0/)
      expect(sc.message).toMatch(/Pick a plan/i)
    })

    it('should throw PaywallError with activation_required when checkLimits returns activationRequired', async () => {
      const plans = [{ reference: 'pln_usage', name: 'Usage' }]
      const balance = { available: 0, currency: 'USD' }
      const productCtx = { name: 'API', ref: 'prd_x', provider: 'acme' }
      mockApiClient.checkLimits = vi.fn().mockResolvedValue({
        withinLimits: false,
        remaining: 0,
        plan: 'usage',
        activationRequired: true,
        plans,
        balance,
        product: productCtx,
        confirmationUrl: 'https://pay.example.com/confirm',
        checkoutUrl: 'https://pay.example.com/checkout',
      })

      const handler = vi.fn()
      const payable = solvaPay.payable({ product: 'usage-product' })
      const protectedHandler = await payable.function(handler)

      await expect(
        protectedHandler({ auth: { customer_ref: 'needs_activation' } }),
      ).rejects.toMatchObject({
        name: 'PaywallError',
        message: 'Activation required',
        structuredContent: {
          kind: 'activation_required',
          product: 'usage-product',
          plans,
          balance,
          productDetails: productCtx,
          confirmationUrl: 'https://pay.example.com/confirm',
          checkoutUrl: 'https://pay.example.com/confirm',
        },
      })

      expect(handler).not.toHaveBeenCalled()
    })

    it('should bypass limits for customers on pro/premium plans', async () => {
      mockApiClient.setUserPlan('pro_user', 'pro')
      const handler = vi.fn().mockResolvedValue({ success: true })
      const payable = solvaPay.payable({ product: 'test' })
      const protectedHandler = await payable.function(handler)

      // Should succeed even with very low limits
      const result = await protectedHandler({ auth: { customer_ref: 'pro_user' } })

      expect(result).toEqual({ success: true })
      expect(handler).toHaveBeenCalledOnce()
      expect(mockApiClient.trackUsageCalls[0].outcome).toBe('success')
    })

    it('should track usage with "fail" outcome when handler throws error', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Handler failed'))
      const payable = solvaPay.payable({ product: 'test' })
      const protectedHandler = await payable.function(handler)

      await expect(protectedHandler({ auth: { customer_ref: 'test_user' } })).rejects.toThrow(
        'Handler failed',
      )

      expect(mockApiClient.trackUsageCalls).toHaveLength(1)
      expect(mockApiClient.trackUsageCalls[0].outcome).toBe('fail')
    })
  })

  describe('HTTP Adapter - Express/Fastify Style', () => {
    it('should wrap handlers for Express/Fastify and extract params from req/query/body', async () => {
      const handler = vi.fn().mockResolvedValue({ message: 'success' })
      const payable = solvaPay.payable({ product: 'http-test' })
      const httpHandler = payable.http(handler)

      const mockReq = {
        body: { name: 'test' },
        params: { id: '123' },
        query: { limit: '10' },
        headers: { 'x-customer-ref': 'http_user' },
      }
      const mockReply = {
        code: vi.fn(),
      }

      const result = await httpHandler(mockReq, mockReply)

      expect(result).toEqual({ message: 'success' })
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test',
          id: '123',
          limit: '10',
          auth: { customer_ref: 'cus_http_user' },
        }),
        expect.anything(),
      )
    })

    it('should return 402 Payment Required when paywall blocks HTTP request', async () => {
      mockApiClient.shouldBlock = true
      const handler = vi.fn()
      const payable = solvaPay.payable({ product: 'blocked' })
      const httpHandler = payable.http(handler)

      const mockReq = { headers: { 'x-customer-ref': 'blocked_user' } }
      const mockReply = { code: vi.fn() }

      const result = await httpHandler(mockReq, mockReply)

      expect(mockReply.code).toHaveBeenCalledWith(402)
      expect(result).toMatchObject({
        success: false,
        error: 'Payment required',
        product: 'blocked',
        checkoutUrl: 'https://example.com/checkout',
      })
    })
  })

  describe('Next.js Adapter - App Router Support', () => {
    it('should wrap Next.js route handlers and parse Request objects', async () => {
      const handler = vi.fn().mockResolvedValue({ message: 'next success' })
      const payable = solvaPay.payable({ product: 'next-test' })
      const nextHandler = payable.next(handler)

      const mockRequest = new Request('http://localhost:3000/api/test?limit=5', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-customer-ref': 'next_user',
        },
        body: JSON.stringify({ name: 'test' }),
      })

      const response = await nextHandler(mockRequest)

      expect(response).toBeInstanceOf(Response)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('application/json')

      const data = await response.json()
      expect(data).toEqual({ message: 'next success' })

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test',
          limit: '5',
          auth: { customer_ref: 'cus_next_user' },
        }),
        expect.anything(),
      )
    })

    it('should extract dynamic route params from Next.js context', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })
      const payable = solvaPay.payable({ product: 'next-params' })
      const nextHandler = payable.next(handler)

      const mockRequest = new Request('http://localhost:3000/api/items/123')
      const context = { params: Promise.resolve({ id: '123' }) }

      const response = await nextHandler(mockRequest, context)

      expect(response.status).toBe(200)
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          id: '123',
          auth: { customer_ref: 'cus_demo_user' },
        }),
        expect.anything(),
      )
    })

    it('should return 402 Response when paywall blocks Next.js request', async () => {
      mockApiClient.shouldBlock = true
      const handler = vi.fn()
      const payable = solvaPay.payable({ product: 'next-blocked' })
      const nextHandler = payable.next(handler)

      const mockRequest = new Request('http://localhost:3000/api/test', {
        headers: { 'x-customer-ref': 'blocked_user' },
      })

      const response = await nextHandler(mockRequest)

      expect(response.status).toBe(402)
      expect(response.headers.get('content-type')).toBe('application/json')

      const data = await response.json()
      expect(data).toMatchObject({
        success: false,
        error: 'Payment required',
        product: 'next-blocked',
        checkoutUrl: 'https://example.com/checkout',
      })
    })
  })

  describe('MCP Adapter - AI Tool Protocol', () => {
    it('should wrap MCP tools and format responses in MCP protocol', async () => {
      const handler = vi.fn().mockResolvedValue({ tools: ['test'] })
      const payable = solvaPay.payable({ product: 'mcp-test' })
      const mcpHandler = payable.mcp(handler)

      const result = await mcpHandler(
        {
          input: 'test',
        },
        {
          authInfo: {
            token: 'test-token',
            clientId: 'test-client',
            scopes: ['openid'],
            extra: { customer_ref: 'mcp_user' },
          },
        },
      )

      // MCP adapter wraps response in MCP format
      expect(result).toHaveProperty('content')
      expect(result.content[0].type).toBe('text')
      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult).toEqual({ tools: ['test'] })

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          input: 'test',
          auth: { customer_ref: 'cus_mcp_user' },
        }),
        expect.anything(),
      )
    })

    it('should use payable-level getCustomerRef when adapter-level is not provided', async () => {
      const handler = vi.fn().mockResolvedValue({ ok: true })
      const payable = solvaPay.payable({
        product: 'mcp-custom-ref',
        getCustomerRef: (args: any) => args.identity?.customer || 'fallback',
      })
      const mcpHandler = payable.mcp(handler)

      await mcpHandler({
        identity: { customer: 'custom_customer' },
      })

      expect(mockApiClient.trackUsageCalls[0].customerRef).toContain('custom_customer')
    })

    it('should prioritize adapter-level getCustomerRef over payable-level getCustomerRef', async () => {
      const handler = vi.fn().mockResolvedValue({ ok: true })
      const payable = solvaPay.payable({
        product: 'mcp-custom-ref-priority',
        getCustomerRef: () => 'payable_level',
      })
      const mcpHandler = payable.mcp(handler, {
        getCustomerRef: () => 'adapter_level',
      })

      await mcpHandler({})

      expect(mockApiClient.trackUsageCalls[0].customerRef).toContain('adapter_level')
    })
  })

  describe('ProtectHandlerContext — ctx.respond plumbing', () => {
    it('passes { customerRef, limits } to the handler on cache-miss', async () => {
      const handler = vi.fn().mockResolvedValue({ ok: true })
      const payable = solvaPay.payable({ product: 'ctx-test' })
      const mcpHandler = payable.mcp(handler)

      await mcpHandler(
        { input: 'test' },
        { authInfo: { extra: { customer_ref: 'ctx_user' } } },
      )

      expect(handler).toHaveBeenCalledTimes(1)
      const [, handlerContext] = handler.mock.calls[0]
      expect(handlerContext).toMatchObject({
        customerRef: expect.stringContaining('ctx_user'),
        limits: expect.objectContaining({
          withinLimits: true,
          remaining: expect.any(Number),
        }),
      })
    })

    it('keeps `limits` populated on cache-hit within the TTL window', async () => {
      const checkLimitsSpy = vi.spyOn(mockApiClient, 'checkLimits')
      const handler = vi.fn().mockResolvedValue({ ok: true })
      const payable = solvaPay.payable({ product: 'ctx-cache-test' })
      const mcpHandler = payable.mcp(handler)

      await mcpHandler(
        { a: 1 },
        { authInfo: { extra: { customer_ref: 'cache_user' } } },
      )
      await mcpHandler(
        { a: 2 },
        { authInfo: { extra: { customer_ref: 'cache_user' } } },
      )

      expect(checkLimitsSpy).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledTimes(2)
      const [, ctxFirst] = handler.mock.calls[0]
      const [, ctxSecond] = handler.mock.calls[1]
      expect(ctxFirst.limits).toBeTruthy()
      expect(ctxSecond.limits).toBeTruthy()
      expect(ctxSecond.limits.withinLimits).toBe(true)
    })

    it('forwards `extra` bag as `handlerContext.extra`', async () => {
      const handler = vi.fn().mockResolvedValue({ ok: true })
      const payable = solvaPay.payable({ product: 'ctx-extra-test' })
      const mcpHandler = payable.mcp(handler)

      const extra = { authInfo: { extra: { customer_ref: 'extra_user' }, token: 'tkn' } }
      await mcpHandler({ hello: 'world' }, extra)

      const [, handlerContext] = handler.mock.calls[0]
      expect(handlerContext.extra).toEqual(expect.objectContaining({ authInfo: expect.any(Object) }))
    })

    it('supports legacy one-arg handlers (backwards compatible)', async () => {
      const legacyHandler = vi.fn(async (args: any) => ({ args }))
      const payable = solvaPay.payable({ product: 'legacy-test' })
      const mcpHandler = payable.mcp(legacyHandler)

      const result = await mcpHandler(
        { foo: 'bar' },
        { authInfo: { extra: { customer_ref: 'legacy_user' } } },
      )

      expect(legacyHandler).toHaveBeenCalledTimes(1)
      expect(result).toHaveProperty('content')
    })
  })

  describe('Customer Authentication - JWT & Headers', () => {
    it('should extract customer reference from JWT Bearer token', async () => {
      // Mock the jose import for Next.js handler
      const mockJwtVerify = vi.fn().mockResolvedValue({
        payload: { sub: 'jwt_user_123' },
      })

      // Mock dynamic import
      vi.doMock('jose', () => ({
        jwtVerify: mockJwtVerify,
      }))

      const handler = vi.fn().mockResolvedValue({ success: true })
      const payable = solvaPay.payable({ product: 'jwt-test' })
      const nextHandler = payable.next(handler)

      const mockRequest = new Request('http://localhost:3000/api/test', {
        headers: {
          authorization: 'Bearer valid.jwt.token',
        },
      })

      // Set environment variables for JWT verification
      process.env.OAUTH_JWKS_SECRET = 'test-secret'
      process.env.OAUTH_ISSUER = 'http://localhost:3000'
      process.env.OAUTH_CLIENT_ID = 'test-client'

      const response = await nextHandler(mockRequest)

      expect(response.status).toBe(200)
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          auth: { customer_ref: 'cus_jwt_user_123' },
        }),
        expect.anything(),
      )
    })

    it('should fallback to x-customer-ref header when JWT is invalid', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })
      const payable = solvaPay.payable({ product: 'fallback-test' })
      const nextHandler = payable.next(handler)

      const mockRequest = new Request('http://localhost:3000/api/test', {
        headers: {
          authorization: 'Bearer invalid.token',
          'x-customer-ref': 'fallback_user',
        },
      })

      const response = await nextHandler(mockRequest)

      expect(response.status).toBe(200)
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          auth: { customer_ref: 'cus_jwt_user_123' },
        }),
        expect.anything(),
      )
    })

    it('should default to "demo_user" when no authentication is provided', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })
      const payable = solvaPay.payable({ product: 'default-test' })
      const nextHandler = payable.next(handler)

      const mockRequest = new Request('http://localhost:3000/api/test')

      const response = await nextHandler(mockRequest)

      expect(response.status).toBe(200)
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          auth: { customer_ref: 'cus_demo_user' },
        }),
        expect.anything(),
      )
    })
  })

  describe('Action Name Resolution', () => {
    it('should record usage with action derived from handler name', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })
      const payable = solvaPay.payable({ product: 'custom-product' })
      const protectedHandler = await payable.function(handler)

      await protectedHandler({ auth: { customer_ref: 'test_user' } })

      expect(mockApiClient.trackUsageCalls[0].metadata?.action).toBeDefined()
      expect(mockApiClient.trackUsageCalls[0].customerRef).toContain('test_user')
    })

    it('should derive action from usageType default', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })
      const payable = solvaPay.payable({})
      const protectedHandler = await payable.function(handler)

      await protectedHandler({ auth: { customer_ref: 'test_user' } })

      expect(mockApiClient.trackUsageCalls[0].metadata?.action).toBe('requests')
    })

    it('should use meterName from checkLimits response as action', async () => {
      const originalCheckLimits = mockApiClient.checkLimits.bind(mockApiClient)
      mockApiClient.checkLimits = async (params: any) => {
        const result = await originalCheckLimits(params)
        return { ...result, meterName: 'api_calls' }
      }

      const handler = vi.fn().mockResolvedValue({ success: true })
      const payable = solvaPay.payable({ product: 'meter-test', usageType: 'tokens' })
      const protectedHandler = await payable.function(handler)

      await protectedHandler({ auth: { customer_ref: 'test_user' } })

      expect(mockApiClient.trackUsageCalls[0].metadata?.action).toBe('api_calls')
    })

    it('should include outcome and requestId in usage tracking', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })
      const payable = solvaPay.payable({})
      const protectedHandler = await payable.function(handler)

      await protectedHandler({ auth: { customer_ref: 'test_user' } })

      expect(mockApiClient.trackUsageCalls[0].outcome).toBe('success')
      expect(mockApiClient.trackUsageCalls[0].metadata).toBeDefined()
      expect(mockApiClient.trackUsageCalls[0].metadata?.requestId).toBeDefined()
    })
  })

  describe('Plan simplification - no plan/planRef in payable flow', () => {
    it('should never forward planRef to checkLimits', async () => {
      const checkLimitsSpy = vi.spyOn(mockApiClient, 'checkLimits')
      const handler = vi.fn().mockResolvedValue({ success: true })
      // Even if extra properties sneak through via cast, planRef should not appear in checkLimits
      const payable = solvaPay.payable({ product: 'prd_test' } as any)
      const protectedHandler = await payable.function(handler)

      await protectedHandler({ auth: { customer_ref: 'cus_plan_user' } })

      const callArgs = checkLimitsSpy.mock.calls[0][0]
      expect(callArgs).not.toHaveProperty('planRef')
    })

    it('should use a cache key without plan segment', async () => {
      const checkLimitsSpy = vi.spyOn(mockApiClient, 'checkLimits')
      const handler = vi.fn().mockResolvedValue({ success: true })

      // Two payables for the same product+usageType should share cache (no plan-based isolation)
      const payable = solvaPay.payable({ product: 'prd_cache' })
      const protectedHandler = await payable.function(handler)

      await protectedHandler({ auth: { customer_ref: 'cus_cache_plan' } })
      expect(checkLimitsSpy).toHaveBeenCalledTimes(1)

      await protectedHandler({ auth: { customer_ref: 'cus_cache_plan' } })
      expect(checkLimitsSpy).toHaveBeenCalledTimes(1)
    })

    it('should call trackUsage with only 6 parameters (no planRef)', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })
      const payable = solvaPay.payable({ product: 'prd_track' })
      const protectedHandler = await payable.function(handler)

      await protectedHandler({ auth: { customer_ref: 'cus_track_user' } })

      expect(mockApiClient.trackUsageCalls).toHaveLength(1)
      // trackUsage should not pass productRef since it is unused dead code
      expect(mockApiClient.trackUsageCalls[0]).toBeDefined()
    })

    it('should build metadata with only product and usageType (no plan)', async () => {
      const checkLimitsSpy = vi.spyOn(mockApiClient, 'checkLimits')
      const handler = vi.fn().mockResolvedValue({ ok: true })
      const payable = solvaPay.payable({ product: 'prd_no_plan' })
      const protectedHandler = await payable.function(handler)

      await protectedHandler({ auth: { customer_ref: 'cus_no_plan' } })

      const callArgs = checkLimitsSpy.mock.calls[0][0]
      expect(callArgs).toEqual(
        expect.objectContaining({ productRef: 'prd_no_plan', meterName: 'requests' }),
      )
      expect(callArgs).not.toHaveProperty('planRef')
    })
  })

  describe('checkLimits Cache', () => {
    it('should serve cached checkLimits result on second call', async () => {
      const checkLimitsSpy = vi.spyOn(mockApiClient, 'checkLimits')
      const handler = vi.fn().mockResolvedValue({ success: true })
      const payable = solvaPay.payable({ product: 'cache-test' })
      const protectedHandler = await payable.function(handler)

      await protectedHandler({ auth: { customer_ref: 'cus_cache_user' } })
      expect(checkLimitsSpy).toHaveBeenCalledTimes(1)

      await protectedHandler({ auth: { customer_ref: 'cus_cache_user' } })
      expect(checkLimitsSpy).toHaveBeenCalledTimes(1)
    })

    it('should invalidate cache when remaining reaches 0', async () => {
      const checkLimitsSpy = vi
        .spyOn(mockApiClient, 'checkLimits')
        .mockResolvedValue({ withinLimits: true, remaining: 2, plan: 'free' })

      const handler = vi.fn().mockResolvedValue({ success: true })
      const payable = solvaPay.payable({ product: 'cache-invalidate' })
      const protectedHandler = await payable.function(handler)

      // Call 1: API hit, request consumes one unit, caches remaining=1
      await protectedHandler({ auth: { customer_ref: 'cus_limit_user' } })
      expect(checkLimitsSpy).toHaveBeenCalledTimes(1)

      // Call 2: cache hit, decrements to 0, deletes entry
      await protectedHandler({ auth: { customer_ref: 'cus_limit_user' } })
      expect(checkLimitsSpy).toHaveBeenCalledTimes(1)

      // Call 3: cache invalidated, must hit API again
      await protectedHandler({ auth: { customer_ref: 'cus_limit_user' } })
      expect(checkLimitsSpy).toHaveBeenCalledTimes(2)
    })

    it('should short-circuit one follow-up request when api returns remaining=1', async () => {
      const checkLimitsSpy = vi.spyOn(mockApiClient, 'checkLimits').mockResolvedValue({
        withinLimits: true,
        remaining: 1,
        plan: 'free',
        checkoutUrl: 'https://checkout.example.com',
      })

      const handler = vi.fn().mockResolvedValue({ success: true })
      const payable = solvaPay.payable({ product: 'cache-last-unit' })
      const protectedHandler = await payable.function(handler)

      // Call 1: API hit, request consumes the final unit and caches remaining=0
      await protectedHandler({ auth: { customer_ref: 'cus_last_unit_user' } })
      expect(checkLimitsSpy).toHaveBeenCalledTimes(1)

      // Call 2: no API call; request is denied from cached zero-remaining state
      await expect(
        protectedHandler({ auth: { customer_ref: 'cus_last_unit_user' } }),
      ).rejects.toBeInstanceOf(PaywallError)
      expect(checkLimitsSpy).toHaveBeenCalledTimes(1)

      // Call 3: cached zero entry was consumed; next request re-checks limits via API
      await protectedHandler({ auth: { customer_ref: 'cus_last_unit_user' } })
      expect(checkLimitsSpy).toHaveBeenCalledTimes(2)
    })

    it('should expire cache after TTL', async () => {
      vi.useFakeTimers()

      const checkLimitsSpy = vi.spyOn(mockApiClient, 'checkLimits')
      const handler = vi.fn().mockResolvedValue({ success: true })
      const payable = solvaPay.payable({ product: 'cache-ttl' })
      const protectedHandler = await payable.function(handler)

      await protectedHandler({ auth: { customer_ref: 'cus_ttl_user' } })
      expect(checkLimitsSpy).toHaveBeenCalledTimes(1)

      // Advance past the default 10s TTL
      vi.advanceTimersByTime(11_000)

      await protectedHandler({ auth: { customer_ref: 'cus_ttl_user' } })
      expect(checkLimitsSpy).toHaveBeenCalledTimes(2)

      vi.useRealTimers()
    })

    it('should keep cache entries isolated by usageType', async () => {
      const checkLimitsSpy = vi.spyOn(mockApiClient, 'checkLimits')
      const handler = vi.fn().mockResolvedValue({ success: true })

      const requestsPayable = solvaPay.payable({
        product: 'cache-usage-type',
        usageType: 'requests',
      })
      const tokensPayable = solvaPay.payable({
        product: 'cache-usage-type',
        usageType: 'tokens',
      })

      const requestsHandler = await requestsPayable.function(handler)
      const tokensHandler = await tokensPayable.function(handler)

      await requestsHandler({ auth: { customer_ref: 'cus_usage_type_user' } })
      expect(checkLimitsSpy).toHaveBeenCalledTimes(1)

      await tokensHandler({ auth: { customer_ref: 'cus_usage_type_user' } })
      expect(checkLimitsSpy).toHaveBeenCalledTimes(2)
    })
  })

  describe('Error Types & Handling', () => {
    it('should create structured PaywallError with checkoutUrl and metadata', () => {
      const error = new PaywallError('Payment required', {
        kind: 'payment_required',
        product: 'test-product',
        checkoutUrl: 'https://example.com/checkout',
        message: 'Upgrade required',
      })

      expect(error.name).toBe('PaywallError')
      expect(error.message).toBe('Payment required')
      expect(error.structuredContent).toEqual({
        kind: 'payment_required',
        product: 'test-product',
        checkoutUrl: 'https://example.com/checkout',
        message: 'Upgrade required',
      })
    })

    it('should create activation_required PaywallStructuredContent', () => {
      const error = new PaywallError('Activation required', {
        kind: 'activation_required',
        product: 'prd_a',
        message: 'Activate first',
        checkoutUrl: 'https://example.com/confirm',
        plans: [{ reference: 'pln_1' }],
        productDetails: { name: 'P', ref: 'prd_a', provider: 'pv' },
      })

      expect(error.structuredContent.kind).toBe('activation_required')
      expect(error.structuredContent.plans).toHaveLength(1)
    })

    it('should propagate API client errors without swallowing them', async () => {
      const faultyApiClient = {
        checkLimits: vi.fn().mockRejectedValue(new Error('API Error')),
        trackUsage: vi.fn().mockResolvedValue(undefined),
      }

      const faultySolvaPay = createSolvaPay({
        apiClient: faultyApiClient as any,
      })

      const handler = vi.fn()
      const payable = faultySolvaPay.payable({ product: 'test' })
      const protectedHandler = await payable.function(handler)

      await expect(protectedHandler({ auth: { customer_ref: 'test_user' } })).rejects.toThrow(
        'API Error',
      )
    })

    it('should log but not throw when usage tracking fails', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      mockApiClient.trackUsage = vi.fn().mockRejectedValue(new Error('Tracking failed'))

      const handler = vi.fn().mockResolvedValue({ success: true })
      const payable = solvaPay.payable({ product: 'test' })
      const protectedHandler = await payable.function(handler)

      const result = await protectedHandler({ auth: { customer_ref: 'test_user' } })

      expect(result).toEqual({ success: true })

      // trackUsage is fire-and-forget; flush the microtask queue for the error log
      await vi.waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith('Usage tracking failed:', expect.any(Error))
      })

      consoleErrorSpy.mockRestore()
    })
  })

  describe('SolvaPayPaywall.decide()', () => {
    let paywall: SolvaPayPaywall

    beforeEach(() => {
      // `createSolvaPay` doesn't expose the underlying paywall instance
      // on the public surface; drive `decide()` against a fresh instance
      // sharing the same mock client so we exercise the real caching +
      // ensureCustomer behaviour rather than a stub.
      paywall = new SolvaPayPaywall(mockApiClient)
    })

    it('returns an allow decision with limits + customerRef when within limits', async () => {
      const decision = await paywall.decide(
        { auth: { customer_ref: 'decide_ok' } },
        { product: 'decide-product' },
      )
      expect(decision.outcome).toBe('allow')
      if (decision.outcome !== 'allow') throw new Error('unreachable')
      expect(decision.customerRef).toBe('cus_decide_ok')
      expect(decision.limits.withinLimits).toBe(true)
      expect(decision.args).toEqual({ auth: { customer_ref: 'decide_ok' } })
      // `allow` outcomes do NOT emit a trackUsage event from decide() —
      // the caller (protect/adapter) is responsible for tracking the
      // handler's success/fail outcome once it runs.
      expect(mockApiClient.trackUsageCalls).toHaveLength(0)
    })

    it('returns a payment_required gate when limits are exhausted', async () => {
      mockApiClient.shouldBlock = true
      const decision = await paywall.decide(
        { auth: { customer_ref: 'decide_blocked' } },
        { product: 'decide-blocked-product' },
      )
      expect(decision.outcome).toBe('gate')
      if (decision.outcome !== 'gate') throw new Error('unreachable')
      expect(decision.gate.kind).toBe('payment_required')
      expect(decision.gate.product).toBe('decide-blocked-product')
      expect(decision.gate.checkoutUrl).toBe('https://example.com/checkout')
      expect(decision.gate.message).toMatch(/Pick a plan/i)
      expect(decision.customerRef).toBe('cus_decide_blocked')
      // decide() emits the paywall-outcome usage event so observability
      // matches the legacy throw-based path.
      expect(mockApiClient.trackUsageCalls).toHaveLength(1)
      expect(mockApiClient.trackUsageCalls[0].outcome).toBe('paywall')
    })

    it('returns an activation_required gate when the plan is pending activation', async () => {
      const plans = [{ reference: 'pln_usage', name: 'Usage' }]
      const balance = { available: 0, currency: 'USD' }
      mockApiClient.checkLimits = vi.fn().mockResolvedValue({
        withinLimits: false,
        remaining: 0,
        plan: 'usage',
        activationRequired: true,
        plans,
        balance,
        confirmationUrl: 'https://pay.example.com/confirm',
        checkoutUrl: 'https://pay.example.com/checkout',
      })

      const decision = await paywall.decide(
        { auth: { customer_ref: 'decide_activate' } },
        { product: 'decide-activate-product' },
      )

      expect(decision.outcome).toBe('gate')
      if (decision.outcome !== 'gate') throw new Error('unreachable')
      expect(decision.gate.kind).toBe('activation_required')
      if (decision.gate.kind !== 'activation_required') throw new Error('unreachable')
      expect(decision.gate.product).toBe('decide-activate-product')
      expect(decision.gate.plans).toEqual(plans)
      expect(decision.gate.balance).toEqual(balance)
      expect(decision.gate.confirmationUrl).toBe('https://pay.example.com/confirm')
      // confirmationUrl takes precedence over checkoutUrl when present.
      expect(decision.gate.checkoutUrl).toBe('https://pay.example.com/confirm')
      expect(mockApiClient.trackUsageCalls).toHaveLength(1)
      expect(mockApiClient.trackUsageCalls[0].outcome).toBe('paywall')
    })
  })
})
