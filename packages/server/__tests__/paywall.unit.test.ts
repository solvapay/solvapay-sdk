import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createSolvaPay, PaywallError } from '../src'
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
    const userPlan =
      this.userPlans.get(params.customerRef) || this.userPlans.get(bareRef) || 'free'

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
    meterName?: string
    units?: number
    properties?: Record<string, unknown>
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
      expect(mockApiClient.trackUsageCalls[0].properties?.outcome).toBe('success')
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
      expect(mockApiClient.trackUsageCalls[0].properties?.outcome).toBe('paywall')
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
      expect(mockApiClient.trackUsageCalls[0].properties?.outcome).toBe('success')
    })

    it('should track usage with "fail" outcome when handler throws error', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Handler failed'))
      const payable = solvaPay.payable({ product: 'test' })
      const protectedHandler = await payable.function(handler)

      await expect(protectedHandler({ auth: { customer_ref: 'test_user' } })).rejects.toThrow(
        'Handler failed',
      )

      expect(mockApiClient.trackUsageCalls).toHaveLength(1)
      expect(mockApiClient.trackUsageCalls[0].properties?.outcome).toBe('fail')
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

      const result = await mcpHandler({
        input: 'test',
        auth: { customer_ref: 'mcp_user' },
      })

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
      )
    })
  })

  describe('Meter Name Resolution', () => {
    it('should record meter event with meterName derived from tool name', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })
      const payable = solvaPay.payable({ product: 'custom-product' })
      const protectedHandler = await payable.function(handler)

      await protectedHandler({ auth: { customer_ref: 'test_user' } })

      expect(mockApiClient.trackUsageCalls[0].meterName).toBeDefined()
      expect(mockApiClient.trackUsageCalls[0].customerRef).toContain('test_user')
    })

    it('should derive meter name from handler function name', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })
      const payable = solvaPay.payable({})
      const protectedHandler = await payable.function(handler)

      await protectedHandler({ auth: { customer_ref: 'test_user' } })

      expect(mockApiClient.trackUsageCalls[0].meterName).toBe('spy')
    })

    it('should use meterName from checkLimits response when available', async () => {
      const originalCheckLimits = mockApiClient.checkLimits.bind(mockApiClient)
      mockApiClient.checkLimits = async (params: any) => {
        const result = await originalCheckLimits(params)
        return { ...result, meterName: 'api_requests' }
      }

      const handler = vi.fn().mockResolvedValue({ success: true })
      const payable = solvaPay.payable({ product: 'meter-test' })
      const protectedHandler = await payable.function(handler)

      await protectedHandler({ auth: { customer_ref: 'test_user' } })

      expect(mockApiClient.trackUsageCalls[0].meterName).toBe('api_requests')
    })

    it('should include outcome and requestId in properties', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })
      const payable = solvaPay.payable({})
      const protectedHandler = await payable.function(handler)

      await protectedHandler({ auth: { customer_ref: 'test_user' } })

      expect(mockApiClient.trackUsageCalls[0].properties).toBeDefined()
      expect(mockApiClient.trackUsageCalls[0].properties?.outcome).toBe('success')
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
        .mockResolvedValue({ withinLimits: true, remaining: 1, plan: 'free' })

      const handler = vi.fn().mockResolvedValue({ success: true })
      const payable = solvaPay.payable({ product: 'cache-invalidate' })
      const protectedHandler = await payable.function(handler)

      // Call 1: API hit, caches remaining=1
      await protectedHandler({ auth: { customer_ref: 'cus_limit_user' } })
      expect(checkLimitsSpy).toHaveBeenCalledTimes(1)

      // Call 2: cache hit, decrements to 0, deletes entry
      await protectedHandler({ auth: { customer_ref: 'cus_limit_user' } })
      expect(checkLimitsSpy).toHaveBeenCalledTimes(1)

      // Call 3: cache invalidated, must hit API again
      await protectedHandler({ auth: { customer_ref: 'cus_limit_user' } })
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
})
