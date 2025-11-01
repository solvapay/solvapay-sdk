import { describe, it, expect, beforeEach } from 'vitest'
import { demoApiClient } from '../../services/apiClient'
import { paywallService } from '../../services/paywallService'

describe('Services', () => {
  describe('DemoApiClient', () => {
    beforeEach(async () => {
      // Reset the client state using public API
      await demoApiClient.resetUsage()
    })

    describe('createCustomer', () => {
      it('should create customer reference from email', async () => {
        const result = await demoApiClient.createCustomer({
          email: 'test@example.com',
          name: 'Test User'
        })

        expect(result.customerRef).toMatch(/^cust_test_example_com_/)
      })

      it('should handle email with special characters', async () => {
        const result = await demoApiClient.createCustomer({
          email: 'test+tag@example-domain.com',
          name: 'Test User'
        })

        expect(result.customerRef).toMatch(/^cust_test_tag_example_domain_com_/)
      })
    })

    describe('checkLimits', () => {
      it('should allow first call within limits', async () => {
        const result = await demoApiClient.checkLimits({
          requestId: 'req-1',
          customerRef: 'test-customer',
          agentRef: 'test-agent',
          planRef: 'test-plan'
        })

        expect(result.withinLimits).toBe(true)
        expect(result.remaining).toBe(2)
        expect(result.plan).toBe('free')
        expect(result.checkoutUrl).toBeUndefined()
      })

      it('should track multiple calls', async () => {
        const baseParams = {
          customerRef: 'test-customer-2',
          agentRef: 'test-agent',
          planRef: 'test-plan'
        }

        // First call
        const result1 = await demoApiClient.checkLimits({
          ...baseParams,
          requestId: 'req-1'
        })
        expect(result1.withinLimits).toBe(true)
        expect(result1.remaining).toBe(2)

        // Second call
        const result2 = await demoApiClient.checkLimits({
          ...baseParams,
          requestId: 'req-2'
        })
        expect(result2.withinLimits).toBe(true)
        expect(result2.remaining).toBe(1)

        // Third call
        const result3 = await demoApiClient.checkLimits({
          ...baseParams,
          requestId: 'req-3'
        })
        expect(result3.withinLimits).toBe(true)
        expect(result3.remaining).toBe(0)
      })

      it('should block calls after limit exceeded', async () => {
        const baseParams = {
          customerRef: 'test-customer-3',
          agentRef: 'test-agent',
          planRef: 'test-plan'
        }

        // Exhaust free tier
        await demoApiClient.checkLimits({ ...baseParams, requestId: 'req-1' })
        await demoApiClient.checkLimits({ ...baseParams, requestId: 'req-2' })
        await demoApiClient.checkLimits({ ...baseParams, requestId: 'req-3' })
        
        // Fourth call should be blocked
        const result = await demoApiClient.checkLimits({ ...baseParams, requestId: 'req-4' })
        expect(result.withinLimits).toBe(false)
        expect(result.remaining).toBe(0)
        expect(result.checkoutUrl).toBeDefined()
      })

      it('should reset limits for new day', async () => {
        const baseParams = {
          customerRef: 'test-customer-4',
          agentRef: 'test-agent',
          planRef: 'test-plan'
        }

        // First call
        await demoApiClient.checkLimits({ ...baseParams, requestId: 'req-1' })
        
        // Reset usage
        await demoApiClient.resetUsage('test-customer-4')
        
        // Should be allowed again
        const result = await demoApiClient.checkLimits({ ...baseParams, requestId: 'req-2' })
        expect(result.withinLimits).toBe(true)
        expect(result.remaining).toBe(2)
      })
    })

    describe('trackUsage', () => {
      it('should track usage', async () => {
        const params = {
          customerRef: 'test-customer',
          agentRef: 'test-agent',
          planRef: 'test-plan',
          outcome: 'success' as const,
          requestId: 'req-123',
          actionDuration: 100,
          timestamp: new Date().toISOString()
        }

        // Should not throw
        await expect(demoApiClient.trackUsage(params)).resolves.toBeUndefined()
      })
    })

    describe('getCheckoutUrl', () => {
      it('should return checkout URL', () => {
        const url = demoApiClient.getCheckoutUrl('test-customer', 'test-agent')
        expect(url).toContain('/checkout')
        expect(url).toContain('plan=pro')
        expect(url).toContain('customer_ref=test-customer')
        expect(url).toContain('return_url=')
      })
    })
  })

  describe('PaywallService', () => {
    it('should have SolvaPay instance', () => {
      const solvaPay = paywallService.getSolvaPay()
      expect(solvaPay).toBeDefined()
    })

    it('should delegate checkLimits to apiClient', async () => {
      const result = await paywallService.checkLimits('test-customer', 'test-agent')
      expect(result).toBeDefined()
      expect(result.withinLimits).toBe(true)
    })

    it('should delegate trackUsage to apiClient', async () => {
      await expect(paywallService.trackUsage('test-customer', 'test-agent')).resolves.toBeUndefined()
    })

    it('should delegate getCheckoutUrl to apiClient', () => {
      const url = paywallService.getCheckoutUrl('test-customer', 'test-agent')
      expect(url).toContain('/checkout')
    })
  })

  // Note: Tasks service tests removed - tasks are now tested via API routes
  // See things.test.ts for comprehensive API endpoint tests with paywall integration
})
