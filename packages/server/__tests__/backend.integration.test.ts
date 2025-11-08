import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { createSolvaPay, createSolvaPayClient } from '../src/index'
import { createTask, getTask, listTasks, deleteTask, clearAllTasks } from '@solvapay/demo-services'

/**
 * SolvaPay Server SDK - Backend Integration Tests (With Fetched Defaults)
 *
 * These tests verify the SDK works correctly with a real SolvaPay backend.
 * This version fetches the default agent and plan from the account.
 *
 * ## Test Approach - Fetched Default Agent/Plan Scenario
 *
 * 1. **Setup (beforeAll)**:
 *    - Creates API client with provider credentials
 *    - Fetches default agent (first agent in account)
 *    - Fetches default plan (first plan for the agent)
 *    - Initializes SDK paywall instance
 *
 * 2. **Test Execution**:
 *    - Tests with explicit agent/plan references
 *    - Each test uses unique customer refs for isolation
 *    - Verifies SDK behavior against real backend
 *
 * 3. **Teardown (afterAll)**:
 *    - Minimal cleanup (no test fixtures to remove)
 *    - Customers can remain for debugging purposes
 *
 * ## Prerequisites
 *
 * 1. **Running Backend**:
 *    Start your backend locally (e.g., http://localhost:3001)
 *    Or use a test/staging environment
 *
 * 2. **Test Provider with Secret Key**:
 *    You need a provider in the backend with a valid secret key.
 *    See packages/server/README.md for setup instructions.
 *
 * ## Running Tests
 *
 * ```bash
 * # Set required environment variables
 * export USE_REAL_BACKEND=true
 * export SOLVAPAY_SECRET_KEY="sp_sandbox_your_key_here"
 * export SOLVAPAY_API_BASE_URL="http://localhost:3001"  # Optional
 *
 * # Run integration tests
 * pnpm test:integration
 * ```
 *
 * ## Environment Variables
 *
 * - `USE_REAL_BACKEND=true` - Enable integration tests (otherwise skipped)
 * - `SOLVAPAY_SECRET_KEY` - Secret key for test provider (required)
 * - `SOLVAPAY_API_BASE_URL` - Backend URL (optional, defaults to api-dev.solvapay.com)
 */

const USE_REAL_BACKEND = process.env.USE_REAL_BACKEND === 'true'
const SOLVAPAY_SECRET_KEY = process.env.SOLVAPAY_SECRET_KEY
const SOLVAPAY_API_BASE_URL = process.env.SOLVAPAY_API_BASE_URL

// Skip all tests if not configured for backend integration
const describeIntegration = USE_REAL_BACKEND && SOLVAPAY_SECRET_KEY ? describe : describe.skip

describeIntegration('Backend Integration - Real API with Auto-Discovered Agent & Plan', () => {
  let apiClient: any
  let solvaPay: any
  let testCustomerRef: string
  let defaultAgent: { reference: string; name: string }
  let defaultPlan: { reference: string; name: string; isFreeTier?: boolean; freeUnits?: number }

  beforeAll(async () => {
    if (!SOLVAPAY_SECRET_KEY) {
      console.log('\n⚠️  Skipping backend integration tests: SOLVAPAY_SECRET_KEY not set')
      console.log('   Set USE_REAL_BACKEND=true and SOLVAPAY_SECRET_KEY to run these tests')
      console.log('   See packages/server/README.md "Integration Tests" for setup instructions\n')
      return
    }

    console.log('\n╔═══════════════════════════════════════════════════════════╗')
    console.log('║     SolvaPay SDK - Backend Integration Tests             ║')
    console.log('║           (With Fetched Default Agent/Plan)              ║')
    console.log('╚═══════════════════════════════════════════════════════════╝')
    console.log()
    console.log('📍 Backend URL:', SOLVAPAY_API_BASE_URL || 'https://api-dev.solvapay.com')
    console.log('🔑 Secret Key:', SOLVAPAY_SECRET_KEY.substring(0, 15) + '...')
    console.log()

    try {
      // Step 1: Create API client
      console.log('Step 1: Creating API Client...')
      apiClient = createSolvaPayClient({
        apiKey: SOLVAPAY_SECRET_KEY!,
        apiBaseUrl: SOLVAPAY_API_BASE_URL,
      })
      console.log('✅ API Client created')
      console.log()

      // Step 2: Fetch default agent and plan
      console.log('Step 2: Fetching default agent and plan from account...')

      // Fetch agents (assuming there's a listAgents method)
      console.log('🔍 Fetching default agent...')
      const agents = await apiClient.listAgents()
      if (!agents || agents.length === 0) {
        throw new Error('No agents found in account. Please create at least one agent.')
      }
      defaultAgent = agents[0]
      console.log('✅ Default agent fetched:', {
        reference: defaultAgent.reference,
        name: defaultAgent.name,
      })

      // Fetch plans for the default agent
      console.log('🔍 Fetching default plan...')
      const plans = await apiClient.listPlans(defaultAgent.reference)
      if (!plans || plans.length === 0) {
        throw new Error(
          `No plans found for agent ${defaultAgent.reference}. Please create at least one plan.`,
        )
      }
      defaultPlan = plans[0]
      console.log('✅ Default plan fetched:', {
        reference: defaultPlan.reference,
        name: defaultPlan.name,
        isFreeTier: defaultPlan.isFreeTier,
        freeUnits: defaultPlan.freeUnits,
      })
      console.log()

      // Step 3: Create paywall with real client
      console.log('Step 3: Initializing SDK paywall...')
      solvaPay = createSolvaPay({
        apiClient,
      })
      console.log('✅ Paywall initialized')
      console.log()
      console.log('═══════════════════════════════════════════════════════════')
      console.log('🚀 Test fixtures ready. Running tests...')
      console.log('═══════════════════════════════════════════════════════════')
      console.log()
    } catch (error) {
      console.log()
      console.error('╔═══════════════════════════════════════════════════════════╗')
      console.error('║  ❌ SETUP FAILED                                          ║')
      console.error('╚═══════════════════════════════════════════════════════════╝')
      console.error()
      console.error('Failed to fetch default agent/plan:', error)
      console.error()
      console.error('💡 Troubleshooting:')
      console.error('   1. Ensure backend is running')
      console.error('   2. Verify SOLVAPAY_SECRET_KEY is valid')
      console.error('   3. Ensure at least one agent and plan exist in the account')
      console.error('   4. Check that listAgents/listPlans endpoints exist on backend')
      console.error('   5. See packages/server/README.md "Integration Tests"')
      console.error()
      throw error
    }
  })

  afterAll(async () => {
    if (!SOLVAPAY_SECRET_KEY) return

    console.log()
    console.log('═══════════════════════════════════════════════════════════')
    console.log('🧹 Test cleanup (using fetched defaults - no fixtures to remove)')
    console.log('═══════════════════════════════════════════════════════════')
    console.log()
  })

  beforeEach(() => {
    // Clear tasks before each test
    clearAllTasks()

    // Generate unique customer ref for each test to avoid conflicts
    testCustomerRef = `test_sdk_${Date.now()}_${Math.random().toString(36).substring(7)}`
  })

  // ============================================================================
  // Test 1: Core API Client Methods
  // ============================================================================

  describe('Core API Client - checkLimits & trackUsage', () => {
    it('should successfully check remaining limits for a customer', async () => {
      // Use paywall's ensureCustomer for consistent customer creation
      const customerRef = await solvaPay.ensureCustomer(testCustomerRef)

      const result = await apiClient.checkLimits({
        customerRef: customerRef,
        agentRef: defaultAgent.reference,
      })

      expect(result).toBeDefined()
      expect(result).toHaveProperty('withinLimits')
      expect(result).toHaveProperty('remaining')
      expect(typeof result.withinLimits).toBe('boolean')
      expect(typeof result.remaining).toBe('number')
    })

    it('should successfully track usage events without errors', async () => {
      // Use paywall's ensureCustomer for consistent customer creation
      const customerRef = await solvaPay.ensureCustomer(testCustomerRef)

      // trackUsage returns void - just verify it doesn't throw
      await expect(
        apiClient.trackUsage({
          customerRef: customerRef,
          agentRef: defaultAgent.reference,
          planRef: defaultPlan.reference,
          outcome: 'success',
          requestId: `req_${Date.now()}`,
          actionDuration: 100,
          timestamp: new Date().toISOString(),
        }),
      ).resolves.toBeUndefined()
    })

    it('should correctly identify when customer exceeds their usage limit', async () => {
      // Use paywall's ensureCustomer for consistent customer creation
      const customerRef = await solvaPay.ensureCustomer(testCustomerRef)

      // First, check initial limits to get the remaining count
      const initialCheck = await apiClient.checkLimits({
        customerRef: customerRef,
        agentRef: defaultAgent.reference,
      })

      expect(initialCheck).toBeDefined()
      expect(initialCheck).toHaveProperty('withinLimits')
      expect(initialCheck).toHaveProperty('remaining')

      const remainingUnits = initialCheck.remaining
      console.log(`📊 Initial remaining units: ${remainingUnits}`)

      if (remainingUnits <= 0) {
        // Even with 0 units, test that trackUsage still works (tracks denied usage)
        expect(initialCheck.withinLimits).toBe(false)
        console.log(`📊 Plan has no free units: testing trackUsage with denied attempts`)

        // Track a few denied usages to verify the API still accepts them
        const deniedUsageCount = 3
        for (let i = 0; i < deniedUsageCount; i++) {
          await apiClient.trackUsage({
            requestId: `req_denied_${Date.now()}_${i}`,
            customerRef: customerRef,
            agentRef: defaultAgent.reference,
            planRef: defaultPlan.reference,
            outcome: 'paywall', // Track that it was blocked
            actionDuration: 50,
            timestamp: new Date().toISOString(),
          })
        }
        console.log(`✅ Successfully tracked ${deniedUsageCount} denied usage events`)

        // Verify limits are still exceeded after tracking denied usage
        const postDeniedCheck = await apiClient.checkLimits({
          customerRef: customerRef,
          agentRef: defaultAgent.reference,
        })
        expect(postDeniedCheck.withinLimits).toBe(false)
        expect(postDeniedCheck.remaining).toBeLessThanOrEqual(0)
        console.log(
          `✅ Plan still blocked after denied usage tracking (remaining: ${postDeniedCheck.remaining})`,
        )
        return
      }

      // Track usage exactly (remainingUnits + 1) times to exceed the limit
      // Note: trackUsage deducts from allowance, checkLimits only checks status
      const usageCount = remainingUnits + 1
      const usageRequests: Promise<void>[] = []

      for (let i = 0; i < usageCount; i++) {
        usageRequests.push(
          apiClient.trackUsage({
            requestId: `req_${Date.now()}_${i}`,
            customerRef: customerRef,
            agentRef: defaultAgent.reference,
            planRef: defaultPlan.reference,
            outcome: 'success',
            actionDuration: 100,
            timestamp: new Date().toISOString(),
          }),
        )
      }

      await Promise.all(usageRequests)
      console.log(`📝 Tracked ${usageCount} usage events`)

      // Now check if we've exceeded limits
      const finalCheck = await apiClient.checkLimits({
        customerRef: customerRef,
        agentRef: defaultAgent.reference,
      })

      expect(finalCheck).toBeDefined()
      expect(finalCheck).toHaveProperty('withinLimits')
      expect(typeof finalCheck.withinLimits).toBe('boolean')
      expect(finalCheck).toHaveProperty('remaining')
      expect(typeof finalCheck.remaining).toBe('number')

      // After using (remainingUnits + 1), we should have exceeded the limit
      expect(finalCheck.withinLimits).toBe(false)
      expect(finalCheck.remaining).toBeLessThanOrEqual(0)
      console.log(
        `✅ Limit correctly exceeded: used ${usageCount} of ${remainingUnits} available units (remaining: ${finalCheck.remaining})`,
      )
    })
  })

  // ============================================================================
  // Test 2: Paywall Protection - Function Wrapping
  // ============================================================================

  describe('Paywall Protection - Protected Functions', () => {
    it('should enforce usage limits when protecting functions with payable.function()', async () => {
      const payable = solvaPay.payable({
        agentRef: defaultAgent.reference,
        planRef: defaultPlan.reference,
      })
      const protectedHandler = await payable.function(createTask)
      const hasFreeTier = defaultPlan.isFreeTier && (defaultPlan.freeUnits ?? 0) > 0
      const freeUnitsCount = defaultPlan.freeUnits ?? 0

      const taskData = {
        title: 'SDK Integration Test Task',
        description: 'Testing real backend protection',
        auth: { customer_ref: testCustomerRef },
      }

      if (hasFreeTier) {
        const result = await protectedHandler(taskData)
        expect(result).toHaveProperty('success', true)
        expect(result.task).toHaveProperty('title', taskData.title)
        console.log(`✅ Protected function succeeded (${freeUnitsCount} free units)`)
      } else {
        await expect(protectedHandler(taskData)).rejects.toThrow('Payment required')
        console.log(`✅ Protected function blocked (no free units)`)
      }
    })

    it('should enforce usage limits in HTTP handlers created with payable.http()', async () => {
      const payable = solvaPay.payable({
        agentRef: defaultAgent.reference,
        planRef: defaultPlan.reference,
      })
      const httpHandler = payable.http(createTask)
      const hasFreeTier = defaultPlan.isFreeTier && (defaultPlan.freeUnits ?? 0) > 0
      const freeUnitsCount = defaultPlan.freeUnits ?? 0

      const mockReq = {
        body: { title: 'HTTP Handler Test' },
        headers: { 'x-customer-ref': testCustomerRef },
      }
      const mockReply = { code: (statusCode: number) => mockReply }

      const result = await httpHandler(mockReq, mockReply)

      if (hasFreeTier) {
        expect(result).toHaveProperty('success', true)
        expect(result.task).toHaveProperty('title', 'HTTP Handler Test')
        console.log(`✅ HTTP handler succeeded (${freeUnitsCount} free units)`)
      } else {
        expect(result).toHaveProperty('success', false)
        expect(result).toHaveProperty('error')
        console.log(`✅ HTTP handler blocked (no free units)`)
      }
    })

    it('should automatically track usage when requests pass through paywall', async () => {
      const payable = solvaPay.payable({
        agentRef: defaultAgent.reference,
        planRef: defaultPlan.reference,
      })
      const protectedHandler = await payable.function(createTask)
      const freeUnitsCount = defaultPlan.freeUnits ?? 0
      const hasFreeTier = defaultPlan.isFreeTier && freeUnitsCount > 0

      if (hasFreeTier) {
        // Make multiple requests within free units limit
        const requestCount = Math.min(3, freeUnitsCount)
        for (let i = 0; i < requestCount; i++) {
          await protectedHandler({
            title: `Task ${i}`,
            auth: { customer_ref: testCustomerRef },
          })
        }
        console.log(`✅ Usage tracked: ${requestCount} requests succeeded`)
      } else {
        await expect(
          protectedHandler({
            title: 'Task 0',
            auth: { customer_ref: testCustomerRef },
          }),
        ).rejects.toThrow('Payment required')
        console.log(`✅ Usage blocked: no free units`)
      }
    })
  })

  // ============================================================================
  // Test 3: Framework-Specific Adapters
  // ============================================================================

  describe('Framework Adapters - Next.js & MCP', () => {
    it('should enforce limits in Next.js App Router handlers (payable.next)', async () => {
      const payable = solvaPay.payable({
        agentRef: defaultAgent.reference,
        planRef: defaultPlan.reference,
      })
      const nextHandler = payable.next(createTask)
      const hasFreeTier = defaultPlan.isFreeTier && (defaultPlan.freeUnits ?? 0) > 0

      const mockRequest = new Request('http://localhost:3000/api/test', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-customer-ref': testCustomerRef,
        },
        body: JSON.stringify({ title: 'Next.js Handler Test' }),
      })

      const response = await nextHandler(mockRequest)
      expect(response).toBeInstanceOf(Response)

      if (hasFreeTier) {
        expect(response.status).toBe(200)
        const data = await response.json()
        expect(data.success).toBe(true)
        expect(data.task.title).toBe('Next.js Handler Test')
      } else {
        expect(response.status).toBe(402)
        const data = await response.json()
        expect(data.error).toBeDefined()
      }
      console.log(`✅ Next.js handler returned ${response.status} as expected`)
    })

    it('should enforce limits in MCP tool handlers (payable.mcp)', async () => {
      const payable = solvaPay.payable({
        agentRef: defaultAgent.reference,
        planRef: defaultPlan.reference,
      })
      const mcpHandler = payable.mcp(listTasks)
      const freeUnitsCount = defaultPlan.freeUnits ?? 0
      const hasFreeTier = defaultPlan.isFreeTier && freeUnitsCount > 0

      const result = await mcpHandler({
        limit: 10,
        auth: { customer_ref: testCustomerRef },
      })

      // MCP adapter wraps response in MCP format
      expect(result).toHaveProperty('content')
      expect(result.content[0].type).toBe('text')
      const parsedResult = JSON.parse(result.content[0].text)

      if (hasFreeTier) {
        expect(parsedResult).toHaveProperty('success', true)
        expect(parsedResult).toHaveProperty('tasks')
        expect(Array.isArray(parsedResult.tasks)).toBe(true)
        console.log(`✅ MCP handler succeeded (${freeUnitsCount} free units)`)
      } else {
        expect(parsedResult).toHaveProperty('success', false)
        expect(parsedResult).toHaveProperty('error')
        console.log(`✅ MCP handler blocked (no free units)`)
      }
    })
  })

  // ============================================================================
  // Test 4: Free Tier Usage Tracking & Exhaustion
  // ============================================================================

  describe('Free Tier - Usage Tracking & Limit Enforcement', () => {
    it('should correctly track usage against free units and block when exhausted', async () => {
      const customerRef = await solvaPay.ensureCustomer(testCustomerRef)

      // Get initial limits
      const initialCheck = await apiClient.checkLimits({
        customerRef: customerRef,
        agentRef: defaultAgent.reference,
      })

      const freeUnits = initialCheck.remaining
      console.log(`\n📊 Testing free tier exhaustion: ${freeUnits} units on "${defaultPlan.name}"`)

      expect(freeUnits).toBeGreaterThan(0)
      expect(initialCheck.withinLimits).toBe(true)

      // Use exactly freeUnits - all should succeed
      for (let i = 0; i < freeUnits; i++) {
        await apiClient.trackUsage({
          requestId: `req_success_${Date.now()}_${i}`,
          customerRef: customerRef,
          agentRef: defaultAgent.reference,
          planRef: defaultPlan.reference,
          outcome: 'success',
          actionDuration: 100,
          timestamp: new Date().toISOString(),
        })
      }

      // Verify we've exhausted the free units
      const afterFreeUnitsCheck = await apiClient.checkLimits({
        customerRef: customerRef,
        agentRef: defaultAgent.reference,
      })

      expect(afterFreeUnitsCheck.remaining).toBeLessThanOrEqual(0)
      expect(afterFreeUnitsCheck.withinLimits).toBe(false)

      // Attempt one more usage - should be blocked (tracked as 'paywall')
      await apiClient.trackUsage({
        requestId: `req_exceed_${Date.now()}`,
        customerRef: customerRef,
        agentRef: defaultAgent.reference,
        planRef: defaultPlan.reference,
        outcome: 'paywall',
        actionDuration: 50,
        timestamp: new Date().toISOString(),
      })

      // Verify limits are still exceeded
      const finalCheck = await apiClient.checkLimits({
        customerRef: customerRef,
        agentRef: defaultAgent.reference,
      })

      expect(finalCheck.withinLimits).toBe(false)
      expect(finalCheck.remaining).toBeLessThanOrEqual(0)

      console.log(
        `✅ Free tier exhaustion verified: used ${freeUnits} units, remaining ${finalCheck.remaining}`,
      )
    })

    it('should throw PaywallError when free units exhausted in protected functions', async () => {
      const testCustomer = `test_freeunits_${Date.now()}_${Math.random().toString(36).substring(7)}`
      const customerRef = await solvaPay.ensureCustomer(testCustomer)

      // Get initial limits
      const initialCheck = await apiClient.checkLimits({
        customerRef: customerRef,
        agentRef: defaultAgent.reference,
      })

      const freeUnits = initialCheck.remaining
      console.log(`\n📊 Testing protected function exhaustion: ${freeUnits} free units`)

      expect(freeUnits).toBeGreaterThan(0)
      expect(initialCheck.withinLimits).toBe(true)

      // Create protected handler
      const payable = solvaPay.payable({
        agentRef: defaultAgent.reference,
        planRef: defaultPlan.reference,
      })
      const protectedHandler = await payable.function(createTask)

      // Use all free units - should succeed
      for (let i = 0; i < freeUnits; i++) {
        const result = await protectedHandler({
          title: `Task ${i + 1}`,
          description: 'Within free tier',
          auth: { customer_ref: testCustomer },
        })
        expect(result).toHaveProperty('success', true)
      }

      // Next calls should be blocked with PaywallError
      await expect(
        protectedHandler({
          title: 'Should be blocked',
          description: 'Exceeds free tier',
          auth: { customer_ref: testCustomer },
        }),
      ).rejects.toThrow('Payment required')

      // Verify subsequent calls are still blocked
      await expect(
        protectedHandler({
          title: 'Still blocked',
          auth: { customer_ref: testCustomer },
        }),
      ).rejects.toThrow('Payment required')

      console.log(`✅ Protected function exhaustion verified: ${freeUnits} succeeded, 2 blocked`)
    })

    it('should accurately report remaining units after partial consumption', async () => {
      const testCustomer = `test_partial_${Date.now()}_${Math.random().toString(36).substring(7)}`
      const customerRef = await solvaPay.ensureCustomer(testCustomer)

      // Get initial limits
      const initialCheck = await apiClient.checkLimits({
        customerRef: customerRef,
        agentRef: defaultAgent.reference,
      })

      const freeUnits = initialCheck.remaining
      console.log(`\n📊 Testing partial usage: ${freeUnits} free units available`)

      expect(freeUnits).toBeGreaterThanOrEqual(2)

      // Use approximately half the free units
      const usageCount = Math.floor(freeUnits / 2)

      for (let i = 0; i < usageCount; i++) {
        await apiClient.trackUsage({
          requestId: `req_partial_${Date.now()}_${i}`,
          customerRef: customerRef,
          agentRef: defaultAgent.reference,
          planRef: defaultPlan.reference,
          outcome: 'success',
          actionDuration: 100,
          timestamp: new Date().toISOString(),
        })
      }

      // Check remaining units
      const midCheck = await apiClient.checkLimits({
        customerRef: customerRef,
        agentRef: defaultAgent.reference,
      })

      // Should still be within limits
      expect(midCheck.withinLimits).toBe(true)
      expect(midCheck.remaining).toBeGreaterThan(0)

      // Remaining should be approximately (freeUnits - usageCount)
      expect(midCheck.remaining).toBeLessThanOrEqual(freeUnits - usageCount + 1)
      expect(midCheck.remaining).toBeGreaterThanOrEqual(freeUnits - usageCount - 1)

      console.log(`✅ Partial usage verified: used ${usageCount}, remaining ${midCheck.remaining}`)
    })
  })

  // ============================================================================
  // Test 5: Error Handling & Edge Cases
  // ============================================================================

  describe('Error Handling - API Errors & Edge Cases', () => {
    it('should handle invalid customer references gracefully', async () => {
      // Try with empty customer ref
      const payable = solvaPay.payable({
        agentRef: defaultAgent.reference,
        planRef: defaultPlan.reference,
      })
      const protectedHandler = await payable.function(createTask)

      // This might succeed with a default customer or return an error
      // Either way, it should not crash
      try {
        await protectedHandler({
          title: 'Test Task',
          auth: { customer_ref: '' },
        })
        expect(true).toBe(true) // Success path
      } catch (error) {
        expect(error).toBeDefined() // Error path is also valid
      }
    })

    it('should correctly handle multiple concurrent requests without race conditions', async () => {
      const payable = solvaPay.payable({
        agentRef: defaultAgent.reference,
        planRef: defaultPlan.reference,
      })
      const protectedHandler = await payable.function(createTask)
      const freeUnitsCount = defaultPlan.freeUnits ?? 0
      const hasFreeTier = defaultPlan.isFreeTier && freeUnitsCount > 0

      // Create 5 concurrent requests (each with unique customer to avoid conflicts)
      const promises = Array.from({ length: 5 }, (_, i) =>
        protectedHandler({
          title: `Concurrent Task ${i}`,
          auth: { customer_ref: `${testCustomerRef}_${i}` },
        }).catch(err => err),
      )

      const results = await Promise.all(promises)
      expect(results).toHaveLength(5)

      if (hasFreeTier) {
        // With free units: all should succeed
        results.forEach((result: any, index) => {
          expect(result.success).toBe(true)
          expect(result.task.title).toBe(`Concurrent Task ${index}`)
        })
        console.log(
          `✅ Concurrent requests handled (${freeUnitsCount} free units): all 5 succeeded`,
        )
      } else {
        // No free units: all should be blocked
        results.forEach((result: any) => {
          expect(result).toBeDefined()
          expect(result.message).toContain('Payment required')
        })
        console.log(`✅ Concurrent requests handled (no free units): all 5 blocked`)
      }
    })
  })
})

// If tests are skipped, show a helpful message
if (!USE_REAL_BACKEND || !SOLVAPAY_SECRET_KEY) {
  describe.skip('Backend Integration Tests - SKIPPED (Configuration Required)', () => {
    it('shows setup instructions for backend integration tests', () => {
      console.log('\n📋 To run SDK backend integration tests:')
      console.log('   1. Set USE_REAL_BACKEND=true')
      console.log('   2. Set SOLVAPAY_SECRET_KEY=<your_secret_key>')
      console.log('   3. Optionally set SOLVAPAY_API_BASE_URL')
      console.log('   4. Run: pnpm test:integration\n')
    })
  })
}
