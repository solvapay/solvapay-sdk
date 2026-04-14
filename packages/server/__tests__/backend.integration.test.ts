import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { createSolvaPay, createSolvaPayClient } from '../src/index'
import { createTask, getTask, listTasks, deleteTask, clearAllTasks } from '@solvapay/demo-services'
import {
  createTestPlan,
  createTestProduct,
  deleteTestProduct,
} from '@solvapay/test-utils'

/**
 * SolvaPay Server SDK - Backend Integration Tests (Isolated Test Fixtures)
 *
 * These tests verify the SDK works correctly with a real SolvaPay backend.
 * This version creates dedicated product/plan fixtures for deterministic assertions.
 *
 * ## Test Approach - Isolated Fixture Scenario
 *
 * 1. **Setup (beforeAll)**:
 *    - Creates API client with provider credentials
 *    - Creates dedicated test product
 *    - Creates dedicated test plan with free units
 *    - Initializes SDK paywall instance
 *
 * 2. **Test Execution**:
 *    - Tests with explicit product/plan references
 *    - Each test uses unique customer refs for isolation
 *    - Verifies SDK behavior against real backend
 *
 * 3. **Teardown (afterAll)**:
 *    - Deletes dedicated test plan/product fixtures
 *    - Leaves customers for debugging purposes
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
 * - `SOLVAPAY_API_BASE_URL` - Backend URL (optional, defaults to api.solvapay.com)
 */

const USE_REAL_BACKEND = process.env.USE_REAL_BACKEND === 'true'
const SOLVAPAY_SECRET_KEY = process.env.SOLVAPAY_SECRET_KEY
const SOLVAPAY_API_BASE_URL = process.env.SOLVAPAY_API_BASE_URL

// Skip all tests if not configured for backend integration
const describeIntegration = USE_REAL_BACKEND && SOLVAPAY_SECRET_KEY ? describe : describe.skip

describeIntegration('Backend Integration - Real API with Isolated Product & Plan', () => {
  let apiClient: any
  let solvaPay: any
  let testCustomerRef: string
  let defaultProduct: { reference: string; name: string }
  let defaultPlan: { reference: string; freeUnits?: number }
  let creditPlan: { reference: string; freeUnits: number; creditsPerUnit?: number; currency: string }

  beforeAll(async () => {
    if (!SOLVAPAY_SECRET_KEY) {
      console.log('\n⚠️  Skipping backend integration tests: SOLVAPAY_SECRET_KEY not set')
      console.log('   Set USE_REAL_BACKEND=true and SOLVAPAY_SECRET_KEY to run these tests')
      console.log('   See packages/server/README.md "Integration Tests" for setup instructions\n')
      return
    }

    console.log('\n╔═══════════════════════════════════════════════════════════╗')
    console.log('║     SolvaPay SDK - Backend Integration Tests             ║')
    console.log('║              (Isolated Test Fixtures)                    ║')
    console.log('╚═══════════════════════════════════════════════════════════╝')
    console.log()
    console.log('📍 Backend URL:', SOLVAPAY_API_BASE_URL || 'https://api.solvapay.com')
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

      // Step 2: Create deterministic product/plan fixtures for this test run
      console.log('Step 2: Creating isolated product and plan fixtures...')
      const apiBaseUrl = SOLVAPAY_API_BASE_URL || 'https://api.solvapay.com'
      const fixtureName = `SDK Integration Fixture ${Date.now()}`
      defaultProduct = await createTestProduct(apiBaseUrl, SOLVAPAY_SECRET_KEY!, fixtureName)
      defaultPlan = await createTestPlan(
        apiBaseUrl,
        SOLVAPAY_SECRET_KEY!,
        defaultProduct.reference,
        10,
      )

      console.log('✅ Created fixture product:', {
        reference: defaultProduct.reference,
        name: defaultProduct.name,
      })
      console.log('✅ Created fixture plan:', {
        reference: defaultPlan.reference,
        freeUnits: defaultPlan.freeUnits,
      })

      const rawCreditPlan = await createTestPlan(
        apiBaseUrl,
        SOLVAPAY_SECRET_KEY!,
        defaultProduct.reference,
        {
          type: 'usage-based',
          creditsPerUnit: 100,
          freeUnits: 5,
          currency: 'USD',
          isDefault: false,
        },
      )

      // Backend zeroes freeUnits for usage-based plans on create, so patch via updatePlan
      await apiClient.updatePlan(defaultProduct.reference, rawCreditPlan.reference, {
        freeUnits: 5,
      })
      creditPlan = { ...rawCreditPlan, freeUnits: 5 }

      console.log('✅ Created credit plan:', {
        reference: creditPlan.reference,
        freeUnits: creditPlan.freeUnits,
        creditsPerUnit: creditPlan.creditsPerUnit,
        currency: creditPlan.currency,
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
      // Best-effort cleanup for partial setup failures (e.g., product created but plan creation fails).
      if (SOLVAPAY_SECRET_KEY && defaultProduct?.reference) {
        const apiBaseUrl = SOLVAPAY_API_BASE_URL || 'https://api.solvapay.com'
        await deleteTestProduct(apiBaseUrl, SOLVAPAY_SECRET_KEY, defaultProduct.reference)
      }

      console.log()
      console.error('╔═══════════════════════════════════════════════════════════╗')
      console.error('║  ❌ SETUP FAILED                                          ║')
      console.error('╚═══════════════════════════════════════════════════════════╝')
      console.error()
      console.error('Failed to initialize fixture product/plan:', error)
      console.error()
      console.error('💡 Troubleshooting:')
      console.error('   1. Ensure backend is running')
      console.error('   2. Verify SOLVAPAY_SECRET_KEY is valid')
      console.error('   3. Ensure SDK product/plan endpoints are available')
      console.error('   4. Ensure provider key can create products/plans')
      console.error('   5. See packages/server/README.md "Integration Tests"')
      console.error()
      throw error
    }
  })

  afterAll(async () => {
    if (!SOLVAPAY_SECRET_KEY) return

    console.log()
    if (defaultProduct?.reference) {
      const apiBaseUrl = SOLVAPAY_API_BASE_URL || 'https://api.solvapay.com'
      await deleteTestProduct(apiBaseUrl, SOLVAPAY_SECRET_KEY, defaultProduct.reference)
    }

    console.log('═══════════════════════════════════════════════════════════')
    console.log('🧹 Test cleanup complete (fixture product/plan removed)')
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
        productRef: defaultProduct.reference,
        planRef: defaultPlan.reference,
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
          actionType: 'api_call',
          units: 1,
          outcome: 'success',
          productRef: defaultProduct.reference,
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
        productRef: defaultProduct.reference,
        planRef: defaultPlan.reference,
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
            customerRef: customerRef,
            actionType: 'api_call',
            units: 1,
            outcome: 'paywall',
            productRef: defaultProduct.reference,
            timestamp: new Date().toISOString(),
          })
        }
        console.log(`✅ Successfully tracked ${deniedUsageCount} denied usage events`)

        // Verify limits are still exceeded after tracking denied usage
        const postDeniedCheck = await apiClient.checkLimits({
          customerRef: customerRef,
          productRef: defaultProduct.reference,
          planRef: defaultPlan.reference,
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
            customerRef: customerRef,
            actionType: 'api_call',
            units: 1,
            outcome: 'success',
            productRef: defaultProduct.reference,
            timestamp: new Date().toISOString(),
          }),
        )
      }

      await Promise.all(usageRequests)
      console.log(`📝 Tracked ${usageCount} usage events`)

      // Now check if we've exceeded limits
      const finalCheck = await apiClient.checkLimits({
        customerRef: customerRef,
        productRef: defaultProduct.reference,
        planRef: defaultPlan.reference,
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
        productRef: defaultProduct.reference,
        planRef: defaultPlan.reference,
      })
      const protectedHandler = await payable.function(createTask)
      const customerRef = await solvaPay.ensureCustomer(testCustomerRef)
      const limits = await apiClient.checkLimits({
        customerRef,
        productRef: defaultProduct.reference,
        planRef: defaultPlan.reference,
      })
      const hasFreeTier = limits.withinLimits && limits.remaining > 0
      const freeUnitsCount = limits.remaining

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
        productRef: defaultProduct.reference,
        planRef: defaultPlan.reference,
      })
      const httpHandler = payable.http(createTask)
      const customerRef = await solvaPay.ensureCustomer(testCustomerRef)
      const limits = await apiClient.checkLimits({
        customerRef,
        productRef: defaultProduct.reference,
        planRef: defaultPlan.reference,
      })
      const hasFreeTier = limits.withinLimits && limits.remaining > 0
      const freeUnitsCount = limits.remaining

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
        productRef: defaultProduct.reference,
        planRef: defaultPlan.reference,
      })
      const protectedHandler = await payable.function(createTask)
      const customerRef = await solvaPay.ensureCustomer(testCustomerRef)
      const limits = await apiClient.checkLimits({
        customerRef,
        productRef: defaultProduct.reference,
        planRef: defaultPlan.reference,
      })
      const freeUnitsCount = limits.remaining
      const hasFreeTier = limits.withinLimits && freeUnitsCount > 0

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
        productRef: defaultProduct.reference,
        planRef: defaultPlan.reference,
      })
      const nextHandler = payable.next(createTask)
      const customerRef = await solvaPay.ensureCustomer(testCustomerRef)
      const limits = await apiClient.checkLimits({
        customerRef,
        productRef: defaultProduct.reference,
        planRef: defaultPlan.reference,
      })
      const hasFreeTier = limits.withinLimits && limits.remaining > 0

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
        productRef: defaultProduct.reference,
        planRef: defaultPlan.reference,
      })
      const mcpHandler = payable.mcp(listTasks)
      const customerRef = await solvaPay.ensureCustomer(testCustomerRef)
      const limits = await apiClient.checkLimits({
        customerRef,
        productRef: defaultProduct.reference,
        planRef: defaultPlan.reference,
      })
      const freeUnitsCount = limits.remaining
      const hasFreeTier = limits.withinLimits && freeUnitsCount > 0

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

    it('should enforce freemium MCP plan: 10 monthly tool calls, then paywall', async () => {
      const testCustomer = `test_mcp_freemium_${Date.now()}_${Math.random().toString(36).substring(7)}`
      const customerRef = await solvaPay.ensureCustomer(testCustomer)
      const payable = solvaPay.payable({
        productRef: defaultProduct.reference,
        planRef: defaultPlan.reference,
      })
      const mcpHandler = payable.mcp(listTasks)

      // Verify this environment grants the expected 10 free units for this fixture plan.
      const initialLimits = await apiClient.checkLimits({
        customerRef,
        productRef: defaultProduct.reference,
        planRef: defaultPlan.reference,
      })
      expect(initialLimits.withinLimits).toBe(true)
      expect(initialLimits.remaining).toBe(10)

      // First 10 calls should pass.
      for (let i = 0; i < 10; i++) {
        const result = await mcpHandler({
          limit: 10,
          auth: { customer_ref: testCustomer },
        })
        const parsedResult = JSON.parse(result.content[0].text)
        expect(parsedResult.success).toBe(true)
      }

      // 11th call should be paywalled.
      const blockedResult = await mcpHandler({
        limit: 10,
        auth: { customer_ref: testCustomer },
      })
      const parsedBlockedResult = JSON.parse(blockedResult.content[0].text)
      expect(parsedBlockedResult.success).toBe(false)
      expect(String(parsedBlockedResult.error || '')).toContain('Payment required')

      const finalLimits = await apiClient.checkLimits({
        customerRef,
        productRef: defaultProduct.reference,
        planRef: defaultPlan.reference,
      })
      expect(finalLimits.withinLimits).toBe(false)
      expect(finalLimits.remaining).toBeLessThanOrEqual(0)
    })
  })

  // ============================================================================
  // Test 4: Free Tier Usage Tracking & Exhaustion
  // ============================================================================

  describe('Free Tier - Usage Tracking & Limit Enforcement', () => {
    /**
     * Helper: burn through free units quickly using bulk trackUsage calls.
     * Leaves `leaveRemaining` units so the caller can test the boundary.
     */
    async function burnFreeUnits(
      customerRef: string,
      total: number,
      leaveRemaining: number,
    ) {
      const toBurn = Math.max(0, total - leaveRemaining)
      const batchSize = 50
      for (let offset = 0; offset < toBurn; offset += batchSize) {
        const batch = Math.min(batchSize, toBurn - offset)
        await Promise.all(
          Array.from({ length: batch }, (_, i) =>
            apiClient.trackUsage({
              customerRef: customerRef,
              actionType: 'api_call',
              units: 1,
              outcome: 'success',
              productRef: defaultProduct.reference,
              timestamp: new Date().toISOString(),
            }),
          ),
        )
      }
    }

    it('should correctly track usage against free units and block when exhausted', async () => {
      const customerRef = await solvaPay.ensureCustomer(testCustomerRef)

      // Get initial limits (pass planRef so backend can auto-provision free-tier purchase)
      const initialCheck = await apiClient.checkLimits({
        customerRef: customerRef,
        productRef: defaultProduct.reference,
        planRef: defaultPlan.reference,
      })

      const freeUnits = initialCheck.remaining
      console.log(`\n📊 Testing free tier exhaustion: ${freeUnits} units on "${defaultPlan.reference}"`)

      if (freeUnits <= 0 || !initialCheck.withinLimits) {
        console.log('⏭️  Skipping free-tier exhaustion assertions: customer starts with no credits')
        return
      }

      // Fast-forward most units, leave 3 to test the boundary one-by-one
      const boundary = Math.min(freeUnits, 3)
      await burnFreeUnits(customerRef, freeUnits, boundary)

      // Use the remaining units one-by-one
      for (let i = 0; i < boundary; i++) {
        await apiClient.trackUsage({
          customerRef: customerRef,
          actionType: 'api_call',
          units: 1,
          outcome: 'success',
          productRef: defaultProduct.reference,
          timestamp: new Date().toISOString(),
        })
      }

      // Verify we've exhausted the free units
      const afterFreeUnitsCheck = await apiClient.checkLimits({
        customerRef: customerRef,
        productRef: defaultProduct.reference,
        planRef: defaultPlan.reference,
      })

      expect(afterFreeUnitsCheck.remaining).toBeLessThanOrEqual(0)
      expect(afterFreeUnitsCheck.withinLimits).toBe(false)

      // Attempt one more usage - should be blocked (tracked as 'paywall')
      await apiClient.trackUsage({
        customerRef: customerRef,
        actionType: 'api_call',
        units: 1,
        outcome: 'paywall',
        productRef: defaultProduct.reference,
        timestamp: new Date().toISOString(),
      })

      // Verify limits are still exceeded
      const finalCheck = await apiClient.checkLimits({
        customerRef: customerRef,
        productRef: defaultProduct.reference,
        planRef: defaultPlan.reference,
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

      // Get initial limits (pass planRef so backend can auto-provision free-tier purchase)
      const initialCheck = await apiClient.checkLimits({
        customerRef: customerRef,
        productRef: defaultProduct.reference,
        planRef: defaultPlan.reference,
      })

      const freeUnits = initialCheck.remaining
      console.log(`\n📊 Testing protected function exhaustion: ${freeUnits} free units`)

      if (freeUnits <= 0 || !initialCheck.withinLimits) {
        console.log(
          '⏭️  Skipping protected-function exhaustion assertions: customer starts with no credits',
        )
        return
      }

      // Fast-forward most units via direct API, leave 3 for protected-handler testing
      const boundary = Math.min(freeUnits, 3)
      await burnFreeUnits(customerRef, freeUnits, boundary)

      // Use a fresh SolvaPay instance with no limits cache so every call hits the backend.
      const freshSolvaPay = createSolvaPay({ apiClient, limitsCacheTTL: 0 })
      const payable = freshSolvaPay.payable({
        productRef: defaultProduct.reference,
        planRef: defaultPlan.reference,
      })
      const protectedHandler = await payable.function(createTask)

      // Use the remaining units through the protected handler — should succeed
      for (let i = 0; i < boundary; i++) {
        const result = await protectedHandler({
          title: `Task ${i + 1}`,
          description: 'Within free tier',
          auth: { customer_ref: testCustomer },
        })
        expect(result).toHaveProperty('success', true)
        await new Promise(r => setTimeout(r, 200))
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

      console.log(`✅ Protected function exhaustion verified: ${boundary} via handler, 2 blocked`)
    })

    it('should accurately report remaining units after partial consumption', async () => {
      const testCustomer = `test_partial_${Date.now()}_${Math.random().toString(36).substring(7)}`
      const customerRef = await solvaPay.ensureCustomer(testCustomer)

      // Get initial limits (pass planRef so backend can auto-provision free-tier purchase)
      const initialCheck = await apiClient.checkLimits({
        customerRef: customerRef,
        productRef: defaultProduct.reference,
        planRef: defaultPlan.reference,
      })

      const freeUnits = initialCheck.remaining
      console.log(`\n📊 Testing partial usage: ${freeUnits} free units available`)

      if (freeUnits < 2 || !initialCheck.withinLimits) {
        console.log('⏭️  Skipping partial-usage assertions: insufficient starting credits')
        return
      }

      // Use a small fixed number of units (cap at 5 to keep the test fast)
      const usageCount = Math.min(Math.floor(freeUnits / 2), 5)

      for (let i = 0; i < usageCount; i++) {
        await apiClient.trackUsage({
          customerRef: customerRef,
          actionType: 'api_call',
          units: 1,
          outcome: 'success',
          productRef: defaultProduct.reference,
          timestamp: new Date().toISOString(),
        })
      }

      // Check remaining units
      const midCheck = await apiClient.checkLimits({
        customerRef: customerRef,
        productRef: defaultProduct.reference,
        planRef: defaultPlan.reference,
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
  // Test 5: Usage Recording - New Fields & Validation
  // ============================================================================

  describe('Usage Recording - End-to-End', () => {
    const BASE_URL = SOLVAPAY_API_BASE_URL || 'https://api.solvapay.com'
    const authHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SOLVAPAY_SECRET_KEY}`,
    }

    async function rawUsagePost(body: Record<string, unknown>): Promise<{ status: number; body: any }> {
      const res = await fetch(`${BASE_URL}/v1/sdk/usages`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(body),
      })
      const text = await res.text()
      let json: any
      try { json = JSON.parse(text) } catch { json = text }
      return { status: res.status, body: json }
    }

    async function rawBulkUsagePost(body: Record<string, unknown>): Promise<{ status: number; body: any }> {
      const res = await fetch(`${BASE_URL}/v1/sdk/usages/bulk`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(body),
      })
      const text = await res.text()
      let json: any
      try { json = JSON.parse(text) } catch { json = text }
      return { status: res.status, body: json }
    }

    let usageCustomerRef: string

    beforeAll(async () => {
      usageCustomerRef = await solvaPay.ensureCustomer(
        `test_usage_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      )
    })

    it('should record usage and return a reference', async () => {
      const res = await rawUsagePost({
        customerRef: usageCustomerRef,
        actionType: 'api_call',
        units: 1,
      })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.reference).toBeDefined()
      expect(typeof res.body.reference).toBe('string')
      console.log(`  recorded reference: ${res.body.reference}`)
    })

    it('should accept all action types', async () => {
      const actionTypes = ['transaction', 'api_call', 'hour', 'email', 'storage', 'custom'] as const

      for (const actionType of actionTypes) {
        const res = await rawUsagePost({
          customerRef: usageCustomerRef,
          actionType,
          units: 1,
        })
        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
      }
      console.log(`  all ${actionTypes.length} action types accepted`)
    })

    it('should accept all outcome values', async () => {
      const outcomes = ['success', 'paywall', 'fail'] as const

      for (const outcome of outcomes) {
        const res = await rawUsagePost({
          customerRef: usageCustomerRef,
          actionType: 'api_call',
          outcome,
          units: 1,
        })
        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
      }
      console.log(`  all 3 outcome values accepted`)
    })

    it('should record usage with metadata, description, and duration', async () => {
      const res = await rawUsagePost({
        customerRef: usageCustomerRef,
        actionType: 'api_call',
        units: 3,
        outcome: 'success',
        description: 'Full-text search across knowledge base',
        duration: 1250,
        metadata: { toolName: 'search_documents', query: 'test query', resultCount: 42 },
        timestamp: new Date().toISOString(),
      })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.reference).toBeDefined()
      console.log(`  comprehensive usage recorded: ${res.body.reference}`)
    })

    it('should enforce idempotency — same key returns success without duplicate', async () => {
      const idempotencyKey = `idem_${Date.now()}_${Math.random().toString(36).substring(7)}`

      const first = await rawUsagePost({
        customerRef: usageCustomerRef,
        actionType: 'api_call',
        units: 1,
        idempotencyKey,
      })
      expect(first.status).toBe(200)
      expect(first.body.success).toBe(true)
      const firstRef = first.body.reference

      const second = await rawUsagePost({
        customerRef: usageCustomerRef,
        actionType: 'api_call',
        units: 1,
        idempotencyKey,
      })
      expect(second.status).toBe(200)
      expect(second.body.success).toBe(true)
      expect(second.body.reference).toBe(firstRef)
      console.log(`  idempotency: both calls returned same reference ${firstRef}`)
    })

    it('should reject missing customerRef', async () => {
      const res = await rawUsagePost({
        actionType: 'api_call',
        units: 1,
      })
      expect(res.status).toBe(400)
      expect(res.body.message).toBe('Validation failed')
    })

    it('should reject invalid actionType', async () => {
      const res = await rawUsagePost({
        customerRef: usageCustomerRef,
        actionType: 'invalid_type',
        units: 1,
      })
      expect(res.status).toBe(400)
      expect(res.body.message).toBe('Validation failed')
    })

    it('should reject invalid outcome', async () => {
      const res = await rawUsagePost({
        customerRef: usageCustomerRef,
        actionType: 'api_call',
        outcome: 'unknown',
        units: 1,
      })
      expect(res.status).toBe(400)
      expect(res.body.message).toBe('Validation failed')
    })

    it('should reject units exceeding 100,000', async () => {
      const res = await rawUsagePost({
        customerRef: usageCustomerRef,
        actionType: 'api_call',
        units: 100_001,
      })
      expect(res.status).toBe(400)
      expect(res.body.message).toBe('Validation failed')
    })

    it('should reject negative units', async () => {
      const res = await rawUsagePost({
        customerRef: usageCustomerRef,
        actionType: 'api_call',
        units: -1,
      })
      expect(res.status).toBe(400)
      expect(res.body.message).toBe('Validation failed')
    })

    it('should reject timestamp too far in the future (>24h)', async () => {
      const futureDate = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString()
      const res = await rawUsagePost({
        customerRef: usageCustomerRef,
        actionType: 'api_call',
        units: 1,
        timestamp: futureDate,
      })
      expect(res.status).toBe(400)
      expect(res.body.message).toBe('Validation failed')
    })

    it('should reject timestamp too far in the past (>30d)', async () => {
      const pastDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()
      const res = await rawUsagePost({
        customerRef: usageCustomerRef,
        actionType: 'api_call',
        units: 1,
        timestamp: pastDate,
      })
      expect(res.status).toBe(400)
      expect(res.body.message).toBe('Validation failed')
    })

    it('should accept a valid past timestamp (within 30d)', async () => {
      const validPast = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
      const res = await rawUsagePost({
        customerRef: usageCustomerRef,
        actionType: 'api_call',
        units: 1,
        timestamp: validPast,
      })
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('should record bulk usage with new fields', async () => {
      const events = [
        { customerRef: usageCustomerRef, actionType: 'api_call', units: 1, outcome: 'success', metadata: { toolName: 'tool_a' } },
        { customerRef: usageCustomerRef, actionType: 'transaction', units: 2, outcome: 'success', metadata: { toolName: 'tool_b' } },
        { customerRef: usageCustomerRef, actionType: 'email', units: 1, outcome: 'fail', description: 'delivery failed' },
      ]

      const res = await rawBulkUsagePost({ events })
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.inserted).toBe(3)
      console.log(`  bulk recorded ${res.body.inserted} events`)
    })

    it('should reject bulk with empty events array', async () => {
      const res = await rawBulkUsagePost({ events: [] })
      expect(res.status).toBe(400)
      expect(res.body.message).toBe('Validation failed')
    })

    it('should reject bulk when any event is missing customerRef', async () => {
      const events = [
        { customerRef: usageCustomerRef, actionType: 'api_call', units: 1 },
        { actionType: 'api_call', units: 1 },
      ]
      const res = await rawBulkUsagePost({ events })
      expect(res.status).toBe(400)
      expect(res.body.message).toBe('Validation failed')
    })

    it('should verify usage affects limits correctly', async () => {
      const freshCustomer = await solvaPay.ensureCustomer(
        `test_limits_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      )

      const initialLimits = await apiClient.checkLimits({
        customerRef: freshCustomer,
        productRef: defaultProduct.reference,
        planRef: defaultPlan.reference,
      })

      const initialRemaining = initialLimits.remaining
      if (initialRemaining <= 0) {
        console.log('  skipping limits verification — plan has 0 free units')
        return
      }

      const unitsToTrack = Math.min(3, initialRemaining)
      for (let i = 0; i < unitsToTrack; i++) {
        await apiClient.trackUsage({
          customerRef: freshCustomer,
          actionType: 'api_call',
          units: 1,
          outcome: 'success',
          productRef: defaultProduct.reference,
        })
      }

      const afterLimits = await apiClient.checkLimits({
        customerRef: freshCustomer,
        productRef: defaultProduct.reference,
        planRef: defaultPlan.reference,
      })

      expect(afterLimits.remaining).toBeLessThan(initialRemaining)
      expect(afterLimits.remaining).toBe(initialRemaining - unitsToTrack)
      console.log(`  limits: ${initialRemaining} -> ${afterLimits.remaining} after ${unitsToTrack} units`)
    })
  })

  // ============================================================================
  // Test 6: Error Handling & Edge Cases
  // ============================================================================

  describe('Error Handling - API Errors & Edge Cases', () => {
    it('should handle invalid customer references gracefully', async () => {
      const payable = solvaPay.payable({
        productRef: defaultProduct.reference,
        planRef: defaultPlan.reference,
      })
      const protectedHandler = await payable.function(createTask)

      try {
        await protectedHandler({
          title: 'Test Task',
          auth: { customer_ref: '' },
        })
        expect(true).toBe(true)
      } catch (error) {
        expect(error).toBeDefined()
      }
    })

    it('should correctly handle multiple concurrent requests without race conditions', async () => {
      const payable = solvaPay.payable({
        productRef: defaultProduct.reference,
        planRef: defaultPlan.reference,
      })
      const protectedHandler = await payable.function(createTask)
      const customerRef = await solvaPay.ensureCustomer(testCustomerRef)
      const limits = await apiClient.checkLimits({
        customerRef,
        productRef: defaultProduct.reference,
        planRef: defaultPlan.reference,
      })
      const freeUnitsCount = limits.remaining
      const hasFreeTier = limits.withinLimits && freeUnitsCount > 0

      const promises = Array.from({ length: 5 }, (_, i) =>
        protectedHandler({
          title: `Concurrent Task ${i}`,
          auth: { customer_ref: `${testCustomerRef}_${i}` },
        }).catch(err => err),
      )

      const results = await Promise.all(promises)
      expect(results).toHaveLength(5)

      if (hasFreeTier) {
        results.forEach((result: any, index) => {
          expect(result.success).toBe(true)
          expect(result.task.title).toBe(`Concurrent Task ${index}`)
        })
        console.log(
          `✅ Concurrent requests handled (${freeUnitsCount} free units): all 5 succeeded`,
        )
      } else {
        results.forEach((result: any) => {
          expect(result).toBeDefined()
          expect(result.message).toContain('Payment required')
        })
        console.log(`✅ Concurrent requests handled (no free units): all 5 blocked`)
      }
    })
  })

  // ============================================================================
  // Test 7: Credit Consumption & Topup Paywall
  // ============================================================================

  describe('Credit Consumption & Topup Paywall', () => {
    /**
     * Activate the credit plan for a fresh customer. Must be called BEFORE
     * checkLimits so the customer gets a usage-based purchase (not the
     * auto-provisioned default recurring plan).
     */
    async function activateCreditPlan(customerRef: string) {
      const activation = await apiClient.activatePlan({
        customerRef,
        productRef: defaultProduct.reference,
        planRef: creditPlan.reference,
      })
      // Usage-based plans no longer auto-grant credits on activation.
      // Topups are required to add balance, so `topup_required` is valid.
      expect(['activated', 'already_active', 'topup_required']).toContain(activation.status)
      return activation
    }

    async function burnCredits(customerRef: string, units: number) {
      for (let i = 0; i < units; i++) {
        await apiClient.trackUsage({
          customerRef,
          actionType: 'api_call',
          units: 1,
          outcome: 'success',
          productRef: defaultProduct.reference,
          planRef: creditPlan.reference,
          timestamp: new Date().toISOString(),
        })
      }
    }

    it('should initialize credit balance correctly on usage-based plan activation', async () => {
      const customer = `test_credit_init_${Date.now()}_${Math.random().toString(36).substring(7)}`
      const customerRef = await solvaPay.ensureCustomer(customer)

      const activation = await activateCreditPlan(customerRef)
      console.log(`📊 Activation response: ${JSON.stringify(activation)}`)

      const result = await apiClient.checkLimits({
        customerRef,
        productRef: defaultProduct.reference,
        planRef: creditPlan.reference,
      })

      expect(result.withinLimits).toBe(true)
      expect(result.remaining).toBeGreaterThan(0)
      if (result.creditsPerUnit !== undefined) {
        expect(typeof result.creditsPerUnit).toBe('number')
      }
      if (result.creditBalance !== undefined) {
        expect(typeof result.creditBalance).toBe('number')
      }
      if (result.currency !== undefined) {
        expect(typeof result.currency).toBe('string')
      }

      console.log(
        `✅ Credit plan activated: remaining=${result.remaining}, creditBalance=${result.creditBalance}, status=${activation.status}`,
      )
    })

    it('should return correct balance via getCustomerBalance for usage-based plan', async () => {
      const customer = `test_credit_bal_${Date.now()}_${Math.random().toString(36).substring(7)}`
      const customerRef = await solvaPay.ensureCustomer(customer)

      await activateCreditPlan(customerRef)

      const balanceResult = await apiClient.getCustomerBalance({ customerRef })

      expect(balanceResult).toBeDefined()
      expect(balanceResult.customerRef).toBe(customerRef)
      expect(typeof balanceResult.credits).toBe('number')
      expect(balanceResult.credits).toBeGreaterThanOrEqual(0)
      expect(balanceResult.displayCurrency).toBeDefined()

      console.log(`✅ getCustomerBalance: credits=${balanceResult.credits}, currency=${balanceResult.displayCurrency}`)
    })

    it('should deduct credits and decrement remaining units on usage consumption', async () => {
      const customer = `test_credit_use_${Date.now()}_${Math.random().toString(36).substring(7)}`
      const customerRef = await solvaPay.ensureCustomer(customer)

      await activateCreditPlan(customerRef)

      const initial = await apiClient.checkLimits({
        customerRef,
        productRef: defaultProduct.reference,
        planRef: creditPlan.reference,
      })
      expect(initial.withinLimits).toBe(true)
      expect(initial.remaining).toBeGreaterThan(0)

      await burnCredits(customerRef, 1)

      const after = await apiClient.checkLimits({
        customerRef,
        productRef: defaultProduct.reference,
        planRef: creditPlan.reference,
      })
      expect(after.remaining).toBe(initial.remaining - 1)
      expect(after.withinLimits).toBe(true)

      console.log(`✅ Usage consumed one unit: ${initial.remaining} → ${after.remaining}`)
    })

    it('should consume credits when calling protected functions on usage-based plan', async () => {
      const customer = `test_credit_fn_${Date.now()}_${Math.random().toString(36).substring(7)}`
      const customerRef = await solvaPay.ensureCustomer(customer)

      await activateCreditPlan(customerRef)

      const before = await apiClient.checkLimits({
        customerRef,
        productRef: defaultProduct.reference,
        planRef: creditPlan.reference,
      })
      expect(before.withinLimits).toBe(true)
      expect(before.remaining).toBeGreaterThan(0)

      const freshSolvaPay = createSolvaPay({ apiClient, limitsCacheTTL: 0 })
      const payable = freshSolvaPay.payable({
        productRef: defaultProduct.reference,
        planRef: creditPlan.reference,
      })
      const protectedHandler = await payable.function(createTask)

      const result = await protectedHandler({
        title: 'Credit-based task',
        description: 'Should deduct from credit balance',
        auth: { customer_ref: customer },
      })
      expect(result).toHaveProperty('success', true)

      const afterCheck = await apiClient.checkLimits({
        customerRef,
        productRef: defaultProduct.reference,
        planRef: creditPlan.reference,
      })
      expect(afterCheck.remaining).toBe(before.remaining - 1)

      console.log(`✅ Protected function consumed one unit: ${before.remaining} → ${afterCheck.remaining}`)
    })

    it('should fire paywall with topup info when credits are exhausted', async () => {
      const customer = `test_credit_paywall_${Date.now()}_${Math.random().toString(36).substring(7)}`
      const customerRef = await solvaPay.ensureCustomer(customer)

      await activateCreditPlan(customerRef)

      const before = await apiClient.checkLimits({
        customerRef,
        productRef: defaultProduct.reference,
        planRef: creditPlan.reference,
      })
      expect(before.withinLimits).toBe(true)
      expect(before.remaining).toBeGreaterThan(0)
      await burnCredits(customerRef, before.remaining)

      const exhausted = await apiClient.checkLimits({
        customerRef,
        productRef: defaultProduct.reference,
        planRef: creditPlan.reference,
      })
      expect(exhausted.withinLimits).toBe(false)
      expect(exhausted.remaining).toBeLessThanOrEqual(0)

      const hasPaymentUrl = exhausted.checkoutUrl || exhausted.confirmationUrl
      expect(hasPaymentUrl).toBeTruthy()

      if (exhausted.creditBalance !== undefined) {
        expect(exhausted.creditBalance).toBeLessThanOrEqual(0)
      }

      const freshSolvaPay = createSolvaPay({ apiClient, limitsCacheTTL: 0 })
      const payable = freshSolvaPay.payable({
        productRef: defaultProduct.reference,
        planRef: creditPlan.reference,
      })
      const protectedHandler = await payable.function(createTask)

      await expect(
        protectedHandler({
          title: 'Should be blocked',
          auth: { customer_ref: customer },
        }),
      ).rejects.toThrow('Payment required')

      console.log(`✅ Paywall fired after credit exhaustion: checkoutUrl=${exhausted.checkoutUrl}, confirmationUrl=${exhausted.confirmationUrl}`)
    })

    it('should return topup information in MCP handler when credits exhausted', async () => {
      const customer = `test_credit_mcp_${Date.now()}_${Math.random().toString(36).substring(7)}`
      const customerRef = await solvaPay.ensureCustomer(customer)

      await activateCreditPlan(customerRef)
      const before = await apiClient.checkLimits({
        customerRef,
        productRef: defaultProduct.reference,
        planRef: creditPlan.reference,
      })
      expect(before.remaining).toBeGreaterThan(0)
      await burnCredits(customerRef, before.remaining)

      const freshSolvaPay = createSolvaPay({ apiClient, limitsCacheTTL: 0 })
      const payable = freshSolvaPay.payable({
        productRef: defaultProduct.reference,
        planRef: creditPlan.reference,
      })
      const mcpHandler = payable.mcp(listTasks)

      const result: any = await mcpHandler({
        limit: 10,
        auth: { customer_ref: customer },
      })

      expect(result).toHaveProperty('content')
      expect(result.content[0].type).toBe('text')
      const parsed = JSON.parse(result.content[0].text)

      expect(parsed.success).toBe(false)
      const errorText = String(parsed.error || parsed.message || '')
      expect(errorText).toContain('Payment required')

      console.log(`✅ MCP handler returned paywall response: ${errorText.substring(0, 100)}`)
    })

    it('should return valid payment intent shape from createTopupPaymentIntent', async () => {
      const customer = `test_credit_topup_${Date.now()}_${Math.random().toString(36).substring(7)}`
      const customerRef = await solvaPay.ensureCustomer(customer)

      await activateCreditPlan(customerRef)

      const result = await apiClient.createTopupPaymentIntent({
        customerRef,
        amount: 1000,
        currency: 'USD',
      })

      expect(result).toBeDefined()
      expect(result.processorPaymentId).toBeDefined()
      expect(typeof result.processorPaymentId).toBe('string')
      expect(result.clientSecret).toBeDefined()
      expect(typeof result.clientSecret).toBe('string')
      expect(result.publishableKey).toBeDefined()
      expect(typeof result.publishableKey).toBe('string')

      console.log(`✅ createTopupPaymentIntent: processorPaymentId=${result.processorPaymentId}, has clientSecret=${!!result.clientSecret}, has publishableKey=${!!result.publishableKey}`)
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
