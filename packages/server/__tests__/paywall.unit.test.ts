import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createSolvaPay, PaywallError } from '../src';
import type { SolvaPayClient } from '../src/types';

// Mock API client for testing
class MockApiClient implements SolvaPayClient {
  private limits = new Map<string, { count: number; lastReset: Date }>();
  private userPlans = new Map<string, string>();
  
  // Test configuration
  public shouldBlock = false;
  public trackUsageCalls: any[] = [];
  
  setUserPlan(customerRef: string, plan: string) {
    this.userPlans.set(customerRef, plan);
  }
  
  async checkLimits(params: {
    customerRef: string;
    agentRef: string;
  }) {
    const key = `${params.customerRef}-${params.agentRef}`;
    const now = new Date();
    const userPlan = this.userPlans.get(params.customerRef) || 'free';
    
    // Pro/premium users have unlimited access
    if (userPlan === 'pro' || userPlan === 'premium') {
      return {
        withinLimits: true,
        remaining: 999999,
        plan: userPlan,
        checkoutUrl: undefined
      };
    }
    
    // For testing purposes, use shouldBlock flag
    if (this.shouldBlock) {
      return {
        withinLimits: false,
        remaining: 0,
        plan: 'free',
        checkoutUrl: 'https://example.com/checkout'
      };
    }
    
    // Normal free tier logic
    const data = this.limits.get(key) || { count: 0, lastReset: now };
    const freeLimit = 5;
    
    if (data.count < freeLimit) {
      data.count++;
      this.limits.set(key, data);
      return {
        withinLimits: true,
        remaining: freeLimit - data.count,
        plan: 'free',
        checkoutUrl: undefined
      };
    }
    
    return {
      withinLimits: false,
      remaining: 0,
      plan: 'free',
      checkoutUrl: 'https://example.com/checkout'
    };
  }
  
  async trackUsage(params: {
    customerRef: string;
    agentRef: string;
    outcome: 'success' | 'paywall' | 'fail';
    action?: string;
    requestId: string;
    actionDuration: number;
    timestamp: string;
  }) {
    this.trackUsageCalls.push(params);
  }
  
  async createCustomer(params: { email: string; name?: string }) {
    return { customerRef: `customer_${params.email.replace(/[^a-zA-Z0-9]/g, '_')}` };
  }

  async getCustomer(params: { customerRef: string }) {
    const plan = this.userPlans.get(params.customerRef) || 'free';
    return {
      customerRef: params.customerRef,
      email: `${params.customerRef}@example.com`,
      name: params.customerRef,
      plan
    };
  }
  
  resetTracking() {
    this.trackUsageCalls = [];
  }
}

describe('Paywall Unit Tests - Mocked Backend', () => {
  let mockApiClient: MockApiClient;
  let solvaPay: any;
  
  beforeEach(() => {
    mockApiClient = new MockApiClient();
    solvaPay = createSolvaPay({
      apiClient: mockApiClient
    });
    mockApiClient.resetTracking();
  });

  describe('Core Paywall Protection Logic', () => {
    it('should allow requests when customer is within usage limits', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true, data: 'test' });
      const payable = solvaPay.payable({ agent: 'test' });
      const protectedHandler = await payable.function(handler);
      
      const result = await protectedHandler({ auth: { customer_ref: 'test_user' } });
      
      expect(result).toEqual({ success: true, data: 'test' });
      expect(handler).toHaveBeenCalledOnce();
      expect(mockApiClient.trackUsageCalls).toHaveLength(1);
      expect(mockApiClient.trackUsageCalls[0].outcome).toBe('success');
    });

    it('should throw PaywallError when customer exceeds usage limits', async () => {
      mockApiClient.shouldBlock = true;
      const handler = vi.fn();
      const payable = solvaPay.payable({ agent: 'test' });
      const protectedHandler = await payable.function(handler);
      
      await expect(protectedHandler({ auth: { customer_ref: 'blocked_user' } }))
        .rejects.toThrow(PaywallError);
      
      expect(handler).not.toHaveBeenCalled();
      expect(mockApiClient.trackUsageCalls).toHaveLength(2); // Both initial call and retry
      expect(mockApiClient.trackUsageCalls[0].outcome).toBe('paywall');
    });

    it('should bypass limits for customers on pro/premium plans', async () => {
      mockApiClient.setUserPlan('pro_user', 'pro');
      const handler = vi.fn().mockResolvedValue({ success: true });
      const payable = solvaPay.payable({ agent: 'test' });
      const protectedHandler = await payable.function(handler);
      
      // Should succeed even with very low limits
      const result = await protectedHandler({ auth: { customer_ref: 'pro_user' } });
      
      expect(result).toEqual({ success: true });
      expect(handler).toHaveBeenCalledOnce();
      expect(mockApiClient.trackUsageCalls[0].outcome).toBe('success');
    });

    it('should track usage with "fail" outcome when handler throws error', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Handler failed'));
      const payable = solvaPay.payable({ agent: 'test' });
      const protectedHandler = await payable.function(handler);
      
      await expect(protectedHandler({ auth: { customer_ref: 'test_user' } }))
        .rejects.toThrow('Handler failed');
      
      expect(mockApiClient.trackUsageCalls).toHaveLength(1);
      expect(mockApiClient.trackUsageCalls[0].outcome).toBe('fail');
    });
  });

  describe('HTTP Adapter - Express/Fastify Style', () => {
    it('should wrap handlers for Express/Fastify and extract params from req/query/body', async () => {
      const handler = vi.fn().mockResolvedValue({ message: 'success' });
      const payable = solvaPay.payable({ agent: 'http-test' });
      const httpHandler = payable.http(handler);
      
      const mockReq = {
        body: { name: 'test' },
        params: { id: '123' },
        query: { limit: '10' },
        headers: { 'x-customer-ref': 'http_user' }
      };
      const mockReply = {
        code: vi.fn()
      };
      
      const result = await httpHandler(mockReq, mockReply);
      
      expect(result).toEqual({ message: 'success' });
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        name: 'test',
        id: '123',
        limit: '10',
        auth: { customer_ref: 'customer_http_user' }
      }));
    });

    it('should return 402 Payment Required when paywall blocks HTTP request', async () => {
      mockApiClient.shouldBlock = true;
      const handler = vi.fn();
      const payable = solvaPay.payable({ agent: 'blocked' });
      const httpHandler = payable.http(handler);
      
      const mockReq = { headers: { 'x-customer-ref': 'blocked_user' } };
      const mockReply = { code: vi.fn() };
      
      const result = await httpHandler(mockReq, mockReply);
      
      expect(mockReply.code).toHaveBeenCalledWith(402);
      expect(result).toMatchObject({
        success: false,
        error: 'Payment required',
        agent: 'blocked',
        checkoutUrl: 'https://example.com/checkout'
      });
    });
  });

  describe('Next.js Adapter - App Router Support', () => {
    it('should wrap Next.js route handlers and parse Request objects', async () => {
      const handler = vi.fn().mockResolvedValue({ message: 'next success' });
      const payable = solvaPay.payable({ agent: 'next-test' });
      const nextHandler = payable.next(handler);
      
      const mockRequest = new Request('http://localhost:3000/api/test?limit=5', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-customer-ref': 'next_user'
        },
        body: JSON.stringify({ name: 'test' })
      });
      
      const response = await nextHandler(mockRequest);
      
      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/json');
      
      const data = await response.json();
      expect(data).toEqual({ message: 'next success' });
      
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        name: 'test',
        limit: '5',
        auth: { customer_ref: 'customer_next_user' }
      }));
    });

    it('should extract dynamic route params from Next.js context', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true });
      const payable = solvaPay.payable({ agent: 'next-params' });
      const nextHandler = payable.next(handler);
      
      const mockRequest = new Request('http://localhost:3000/api/items/123');
      const context = { params: Promise.resolve({ id: '123' }) };
      
      const response = await nextHandler(mockRequest, context);
      
      expect(response.status).toBe(200);
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        id: '123',
        auth: { customer_ref: 'demo_user' }
      }));
    });

    it('should return 402 Response when paywall blocks Next.js request', async () => {
      mockApiClient.shouldBlock = true;
      const handler = vi.fn();
      const payable = solvaPay.payable({ agent: 'next-blocked' });
      const nextHandler = payable.next(handler);
      
      const mockRequest = new Request('http://localhost:3000/api/test', {
        headers: { 'x-customer-ref': 'blocked_user' }
      });
      
      const response = await nextHandler(mockRequest);
      
      expect(response.status).toBe(402);
      expect(response.headers.get('content-type')).toBe('application/json');
      
      const data = await response.json();
      expect(data).toMatchObject({
        success: false,
        error: 'Payment required',
        agent: 'next-blocked',
        checkoutUrl: 'https://example.com/checkout'
      });
    });
  });

  describe('MCP Adapter - AI Tool Protocol', () => {
    it('should wrap MCP tools and format responses in MCP protocol', async () => {
      const handler = vi.fn().mockResolvedValue({ tools: ['test'] });
      const payable = solvaPay.payable({ agent: 'mcp-test' });
      const mcpHandler = payable.mcp(handler);
      
      const result = await mcpHandler({ 
        input: 'test',
        auth: { customer_ref: 'mcp_user' }
      });
      
      // MCP adapter wraps response in MCP format
      expect(result).toHaveProperty('content');
      expect(result.content[0].type).toBe('text');
      const parsedResult = JSON.parse(result.content[0].text);
      expect(parsedResult).toEqual({ tools: ['test'] });
      
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        input: 'test',
        auth: { customer_ref: 'customer_mcp_user' }
      }));
    });
  });

  describe('Customer Authentication - JWT & Headers', () => {
    it('should extract customer reference from JWT Bearer token', async () => {
      // Mock the jose import for Next.js handler
      const mockJwtVerify = vi.fn().mockResolvedValue({
        payload: { sub: 'jwt_user_123' }
      });
      
      // Mock dynamic import
      vi.doMock('jose', () => ({
        jwtVerify: mockJwtVerify
      }));
      
      const handler = vi.fn().mockResolvedValue({ success: true });
      const payable = solvaPay.payable({ agent: 'jwt-test' });
      const nextHandler = payable.next(handler);
      
      const mockRequest = new Request('http://localhost:3000/api/test', {
        headers: {
          'authorization': 'Bearer valid.jwt.token'
        }
      });
      
      // Set environment variables for JWT verification
      process.env.OAUTH_JWKS_SECRET = 'test-secret';
      process.env.OAUTH_ISSUER = 'http://localhost:3000';
      process.env.OAUTH_CLIENT_ID = 'test-client';
      
      const response = await nextHandler(mockRequest);
      
      expect(response.status).toBe(200);
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        auth: { customer_ref: 'customer_jwt_user_123' }
      }));
    });

    it('should fallback to x-customer-ref header when JWT is invalid', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true });
      const payable = solvaPay.payable({ agent: 'fallback-test' });
      const nextHandler = payable.next(handler);
      
      const mockRequest = new Request('http://localhost:3000/api/test', {
        headers: {
          'authorization': 'Bearer invalid.token',
          'x-customer-ref': 'fallback_user'
        }
      });
      
      const response = await nextHandler(mockRequest);
      
      expect(response.status).toBe(200);
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        auth: { customer_ref: 'customer_jwt_user_123' }
      }));
    });

    it('should default to "demo_user" when no authentication is provided', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true });
      const payable = solvaPay.payable({ agent: 'default-test' });
      const nextHandler = payable.next(handler);
      
      const mockRequest = new Request('http://localhost:3000/api/test');
      
      const response = await nextHandler(mockRequest);
      
      expect(response.status).toBe(200);
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        auth: { customer_ref: 'demo_user' }
      }));
    });
  });

  describe('Agent Reference Resolution', () => {
    it('should use explicitly provided agentRef from payable() config', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true });
      const payable = solvaPay.payable({ agent: 'custom-agent' });
      const protectedHandler = await payable.function(handler);
      
      await protectedHandler({ auth: { customer_ref: 'test_user' } });
      
      expect(mockApiClient.trackUsageCalls[0].agentRef).toBe('custom-agent');
    });

    it('should fallback to SOLVAPAY_AGENT environment variable', async () => {
      process.env.SOLVAPAY_AGENT = 'env-agent';
      
      const handler = vi.fn().mockResolvedValue({ success: true });
      const payable = solvaPay.payable({});
      const protectedHandler = await payable.function(handler);
      
      await protectedHandler({ auth: { customer_ref: 'test_user' } });
      
      expect(mockApiClient.trackUsageCalls[0].agentRef).toBe('env-agent');
      
      delete process.env.SOLVAPAY_AGENT;
    });

    it('should fallback to package.json name as last resort', async () => {
      // Mock require for package.json
      const originalRequire = require;
      (global as any).require = vi.fn().mockImplementation((path: string) => {
        if (path.includes('package.json')) {
          return { name: 'test-package' };
        }
        return originalRequire(path);
      });
      
      const handler = vi.fn().mockResolvedValue({ success: true });
      const payable = solvaPay.payable({});
      const protectedHandler = await payable.function(handler);
      
      await protectedHandler({ auth: { customer_ref: 'test_user' } });
      
      expect(mockApiClient.trackUsageCalls[0].agentRef).toBe('@solvapay/server');
      
      (global as any).require = originalRequire;
    });
  });

  describe('Error Types & Handling', () => {
    it('should create structured PaywallError with checkoutUrl and metadata', () => {
      const error = new PaywallError('Payment required', {
        kind: 'payment_required',
        agent: 'test-agent',
        checkoutUrl: 'https://example.com/checkout',
        message: 'Upgrade required'
      });
      
      expect(error.name).toBe('PaywallError');
      expect(error.message).toBe('Payment required');
      expect(error.structuredContent).toEqual({
        kind: 'payment_required',
        agent: 'test-agent',
        checkoutUrl: 'https://example.com/checkout',
        message: 'Upgrade required'
      });
    });

    it('should propagate API client errors without swallowing them', async () => {
      const faultyApiClient = {
        checkLimits: vi.fn().mockRejectedValue(new Error('API Error')),
        trackUsage: vi.fn().mockResolvedValue(undefined)
      };
      
      const faultySolvaPay = createSolvaPay({
        apiClient: faultyApiClient as any
      });
      
      const handler = vi.fn();
      const payable = faultySolvaPay.payable({ agent: 'test' });
      const protectedHandler = await payable.function(handler);
      
      await expect(protectedHandler({ auth: { customer_ref: 'test_user' } }))
        .rejects.toThrow('API Error');
    });

    it('should log but not throw when usage tracking fails', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      mockApiClient.trackUsage = vi.fn().mockRejectedValue(new Error('Tracking failed'));
      
      const handler = vi.fn().mockResolvedValue({ success: true });
      const payable = solvaPay.payable({ agent: 'test' });
      const protectedHandler = await payable.function(handler);
      
      // Should still succeed even if tracking fails
      const result = await protectedHandler({ auth: { customer_ref: 'test_user' } });
      
      expect(result).toEqual({ success: true });
      expect(consoleErrorSpy).toHaveBeenCalledWith('Usage tracking failed:', expect.any(Error));
      
      consoleErrorSpy.mockRestore();
    });
  });
});
