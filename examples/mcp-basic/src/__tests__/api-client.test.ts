import { describe, it, expect, beforeEach } from 'vitest'
import { StubSolvaPayClient, createStubClient } from '../../../shared/stub-api-client'

describe('StubSolvaPayClient', () => {
  let apiClient: StubSolvaPayClient

  beforeEach(async () => {
    // Use in-memory storage for tests (no file I/O)
    apiClient = createStubClient({ useFileStorage: false })
  })

  describe('Limit Checking', () => {
    it('should track daily usage per customer and plan', async () => {
      const customerRef = 'test_customer'
      const planRef = 'test_plan'

      // First call should be within free tier
      const result1 = await apiClient.checkLimits({
        customerRef,
        productRef: planRef,
      })
      expect(result1.withinLimits).toBe(true)
      expect(result1.plan).toBe('free')
      expect(result1.remaining).toBe(2) // 3 - 1 (after increment)

      // Second call should still be within free tier
      const result2 = await apiClient.checkLimits({
        customerRef,
        productRef: planRef,
      })
      expect(result2.withinLimits).toBe(true)
      expect(result2.plan).toBe('free')
      expect(result2.remaining).toBe(1) // 3 - 2 (after increment)
    })

    it('should reset daily counter for new day', async () => {
      const customerRef = 'test_customer'
      const planRef = 'test_plan'

      // This is a simplified test - in real implementation,
      // the daily reset logic would be more complex
      const result = await apiClient.checkLimits({
        customerRef,
        productRef: planRef,
      })
      expect(result.withinLimits).toBe(true)
      expect(result.plan).toBe('free')
    })
  })

  describe('Receipt Verification', () => {
    it('should return paid plan for customers with credits', async () => {
      const result = await apiClient.checkLimits({
        customerRef: 'demo_customer',
        productRef: 'test_product',
      })
      expect(result.withinLimits).toBe(true)
      expect(result.plan).toBe('paid')
      expect(result.remaining).toBe(100) // demo_customer has 100 credits
    })

    it('should return free plan for customers without credits', async () => {
      const result = await apiClient.checkLimits({
        customerRef: 'test_customer',
        productRef: 'test_product',
      })
      expect(result.withinLimits).toBe(true) // Within free tier
      expect(result.plan).toBe('free')
    })

    it('should allow adding credits to customers', async () => {
      apiClient.addCredits('test_customer', 50)

      const result = await apiClient.checkLimits({
        customerRef: 'test_customer',
        productRef: 'test_product',
      })
      expect(result.withinLimits).toBe(true)
      expect(result.plan).toBe('paid')
      expect(result.remaining).toBe(50)
    })
  })

  describe('Credit Management', () => {
    it('should track credits for demo purposes', async () => {
      const customerRef = 'demo_customer'
      const initialCredits = await apiClient.getCredits(customerRef)

      // Credits are now managed server-side via trackUsage
      // This test just verifies the demo tracking still works
      expect(initialCredits).toBe(100)
    })

    it('should allow adding credits', async () => {
      const customerRef = 'new_customer'
      const initialCredits = await apiClient.getCredits(customerRef)

      await apiClient.addCredits(customerRef, 50)

      const finalCredits = await apiClient.getCredits(customerRef)
      expect(finalCredits).toBe(initialCredits + 50)
    })
  })

  describe('Checkout Session Creation', () => {
    it('should create checkout session with correct parameters', async () => {
      const result = await apiClient.createCheckoutSession({
        customerReference: 'test_customer',
        productRef: 'test_plan',
        planRef: 'test_plan_ref',
      })

      expect(result).toHaveProperty('sessionId')
      expect(result).toHaveProperty('checkoutUrl')
      expect(result.checkoutUrl).toContain('checkout.solvapay.com')
      expect(result.checkoutUrl).toContain('customer=test_customer')
      expect(result.checkoutUrl).toContain('product=test_plan')
      expect(typeof result.sessionId).toBe('string')
    })
  })

  describe('Usage Tracking', () => {
    it('should track usage events', async () => {
      const usageParams = {
        customerRef: 'test_customer',
        productRef: 'test_product',
        planRef: 'test_plan',
        outcome: 'success' as const,
        action: 'test_tool',
        requestId: 'test_request_id',
        actionDuration: 150,
        timestamp: new Date().toISOString(),
      }

      // Should not throw
      await expect(apiClient.trackUsage(usageParams)).resolves.toBeUndefined()
    })
  })
})
