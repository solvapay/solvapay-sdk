import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { createSolvaPay, createSolvaPayClient } from '../src/index'
import { createTask, clearAllTasks } from '@solvapay/demo-services'
import {
  createTestPaymentIntent,
  confirmPaymentWithTestCard,
  waitForWebhookProcessing,
  STRIPE_TEST_CARDS,
  testLog,
} from '@solvapay/test-utils'

/**
 * SolvaPay Server SDK - Payment Integration Tests
 *
 * These tests verify the complete payment flow with real Stripe integration:
 * 1. Create payment intent via backend SDK
 * 2. Confirm payment with Stripe test cards
 * 3. Wait for Stripe webhook to process
 * 4. Verify credits are added to customer
 * 5. Test that protected endpoints now allow access
 *
 * ## Prerequisites
 *
 * 1. **Running Backend with Stripe Integration**:
 *    - Backend must be running locally or in test environment
 *    - Stripe webhook endpoint configured at `/webhooks/stripe`
 *    - Stripe test mode keys configured
 *
 * 2. **Test Provider with API Key**:
 *    - Valid SolvaPay provider account
 *    - At least one agent and usage-based plan configured
 *
 * 3. **Stripe Test Account**:
 *    - Stripe test mode secret key
 *    - Webhook secret for signature verification
 *
 * ## Running Tests
 *
 * ```bash
 * # Set required environment variables
 * export USE_REAL_BACKEND=true
 * export SOLVAPAY_SECRET_KEY="sp_sandbox_your_key_here"
 * export SOLVAPAY_API_BASE_URL="http://localhost:3001"
 * export STRIPE_TEST_SECRET_KEY="sk_test_your_key_here"
 * export STRIPE_WEBHOOK_SECRET="whsec_your_secret_here"
 *
 * # Run payment integration tests (without webhook tests)
 * pnpm test:integration:payment
 *
 * # Run with webhook tests enabled (requires Stripe CLI forwarding)
 * stripe listen --forward-to localhost:3001/webhooks/stripe
 * ENABLE_WEBHOOK_TESTS=true pnpm test:integration:payment
 * ```
 *
 * ## Environment Variables
 *
 * - `USE_REAL_BACKEND=true` - Enable integration tests
 * - `SOLVAPAY_SECRET_KEY` - SolvaPay secret key
 * - `SOLVAPAY_API_BASE_URL` - Backend URL (optional)
 * - `STRIPE_TEST_SECRET_KEY` - Stripe test mode secret key
 * - `STRIPE_WEBHOOK_SECRET` - Stripe webhook signing secret (optional)
 * - `ENABLE_WEBHOOK_TESTS=true` - Enable E2E webhook tests (requires Stripe CLI)
 */

const USE_REAL_BACKEND = process.env.USE_REAL_BACKEND === 'true'
const SOLVAPAY_SECRET_KEY = process.env.SOLVAPAY_SECRET_KEY
const SOLVAPAY_API_BASE_URL = process.env.SOLVAPAY_API_BASE_URL
const STRIPE_TEST_SECRET_KEY = process.env.STRIPE_TEST_SECRET_KEY
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET
// Enable webhook tests only when explicitly requested (requires Stripe CLI webhook forwarding)
const ENABLE_WEBHOOK_TESTS = process.env.ENABLE_WEBHOOK_TESTS === 'true'

// Skip all tests if not configured for payment integration
const describePaymentIntegration =
  USE_REAL_BACKEND && SOLVAPAY_SECRET_KEY && STRIPE_TEST_SECRET_KEY ? describe : describe.skip

describePaymentIntegration('Payment Integration - End-to-End Stripe Checkout Flow', () => {
  let apiClient: any
  let solvaPay: any
  let stripeClient: any // Stripe Node.js client
  let testCustomerRef: string
  let defaultAgent: { reference: string; name: string }
  let defaultPlan: { reference: string; name: string; isFreeTier?: boolean; freeUnits?: number }
  let usageBasedPlan: {
    reference: string
    name: string
    pricePerUnit?: number
    type?: string
    freeUnits?: string
  } | null = null

  beforeAll(async () => {
    if (!SOLVAPAY_SECRET_KEY || !STRIPE_TEST_SECRET_KEY) {
      console.log('\n⚠️  Skipping payment integration tests: Missing required configuration')
      console.log('   Required: USE_REAL_BACKEND=true, SOLVAPAY_SECRET_KEY, STRIPE_TEST_SECRET_KEY')
      console.log(
        '   See packages/server/README.md "Payment Integration Tests" for setup instructions\n',
      )
      return
    }

    console.log('\n╔═══════════════════════════════════════════════════════════╗')
    console.log('║     Payment Integration Tests - Stripe Flow              ║')
    console.log('╚═══════════════════════════════════════════════════════════╝')
    console.log()
    console.log('📍 Backend URL:', SOLVAPAY_API_BASE_URL || 'https://api.solvapay.com')
    console.log('🔑 Secret Key:', SOLVAPAY_SECRET_KEY.substring(0, 50) + '...')
    console.log('💳 Stripe:', STRIPE_TEST_SECRET_KEY.substring(0, 15) + '...')
    console.log()

    try {
      // Step 1: Create SolvaPay API client
      console.log('Step 1: Creating SolvaPay API Client...')
      apiClient = createSolvaPayClient({
        apiKey: SOLVAPAY_SECRET_KEY!,
        apiBaseUrl: SOLVAPAY_API_BASE_URL,
      })
      console.log('✅ API Client created')
      console.log()

      // Step 2: Fetch default agent and plan from backend
      console.log('Step 2: Fetching default agent and plan...')

      const agents = await apiClient.listAgents()
      if (!agents || agents.length === 0) {
        throw new Error('No agents found. Please create at least one agent in your account.')
      }

      // Find an agent that has plans (try each agent until we find one with plans)
      let plans: any[] = []
      for (const agent of agents) {
        const agentPlans = await apiClient.listPlans(agent.reference)
        if (agentPlans && agentPlans.length > 0) {
          defaultAgent = agent
          plans = agentPlans
          break
        }
      }

      if (!defaultAgent) {
        throw new Error('No agents with plans found. Please create at least one plan for an agent.')
      }

      console.log('✅ Default agent fetched:', {
        reference: defaultAgent.reference,
        name: defaultAgent.name,
      })

      if (plans.length === 0) {
        throw new Error(
          `No plans found for agent ${defaultAgent.reference}. Please create at least one plan.`,
        )
      }
      defaultPlan = plans[0]

      // Look for usage-based plan (for payment testing)
      usageBasedPlan = plans.find((p: any) => p.type === 'usage-based' || p.pricePerUnit) || null

      console.log('✅ Default plan fetched:', {
        reference: defaultPlan.reference,
        name: defaultPlan.name,
        isFreeTier: defaultPlan.isFreeTier,
        freeUnits: defaultPlan.freeUnits,
      })

      if (usageBasedPlan) {
        console.log('✅ Usage-based plan found:', {
          reference: usageBasedPlan.reference,
          name: usageBasedPlan.name,
        })
      } else {
        console.log('⚠️  No usage-based plan found - will use default plan for testing')
      }
      console.log()

      // Step 3: Initialize Stripe client
      console.log('Step 3: Initializing Stripe client...')

      // Dynamically import Stripe to avoid requiring it in all tests
      const { default: Stripe } = await import('stripe')
      stripeClient = new Stripe(STRIPE_TEST_SECRET_KEY!, {
        apiVersion: '2025-02-24.acacia',
      })

      console.log('✅ Stripe client initialized')
      console.log()

      // Step 4: Initialize SolvaPay paywall
      console.log('Step 4: Initializing SolvaPay paywall...')
      solvaPay = createSolvaPay({ apiClient })
      console.log('✅ Paywall initialized')
      console.log()

      // Step 5: Verify provider has Stripe Connect account configured
      console.log('Step 5: Verifying Stripe Connect setup...')
      try {
        // Create a temporary test customer to verify Stripe is configured
        const testRef = `stripe_check_${Date.now()}`
        const testCustomer = await solvaPay.ensureCustomer(testRef)

        // Try to create a payment intent to check if Stripe is configured
        const planToTest = usageBasedPlan || defaultPlan
        await createTestPaymentIntent(
          apiClient,
          defaultAgent.reference,
          planToTest.reference,
          testCustomer,
        )

        console.log('✅ Stripe Connect account verified')
        console.log()
      } catch (error: any) {
        if (error.message?.includes('does not have a Stripe account')) {
          console.log()
          console.warn('╔═══════════════════════════════════════════════════════════╗')
          console.warn('║  ⚠️  STRIPE NOT CONFIGURED - TESTS WILL BE SKIPPED       ║')
          console.warn('╚═══════════════════════════════════════════════════════════╝')
          console.warn()
          console.warn('Your provider account does not have Stripe Connect configured.')
          console.warn()
          console.warn('📋 To enable payment integration tests:')
          console.warn('   1. Log in to your SolvaPay provider dashboard')
          console.warn('   2. Navigate to Payment Settings')
          console.warn('   3. Connect your Stripe account via Stripe Connect')
          console.warn('   4. Complete the onboarding process')
          console.warn('   5. Re-run the tests')
          console.warn()
          console.warn('💡 These tests require a Stripe Connect account to create payment intents.')
          console.warn('   See: https://stripe.com/docs/connect')
          console.warn()

          // Mark that we should skip tests
          throw new Error('STRIPE_NOT_CONFIGURED')
        }
        // Re-throw other errors
        throw error
      }

      console.log('═══════════════════════════════════════════════════════════')
      console.log('🚀 Test setup complete. Running tests...')
      console.log('═══════════════════════════════════════════════════════════')
      console.log()
    } catch (error: any) {
      // If Stripe not configured, skip gracefully
      if (error.message === 'STRIPE_NOT_CONFIGURED') {
        // Set flag to skip tests
        ;(global as any).__SKIP_PAYMENT_TESTS__ = true
        return
      }

      console.log()
      console.error('╔═══════════════════════════════════════════════════════════╗')
      console.error('║  ❌ SETUP FAILED                                          ║')
      console.error('╚═══════════════════════════════════════════════════════════╝')
      console.error()
      console.error('Failed to initialize payment integration tests:', error)
      console.error()
      console.error('💡 Troubleshooting:')
      console.error('   1. Ensure backend is running with Stripe integration')
      console.error('   2. Verify SOLVAPAY_SECRET_KEY is valid')
      console.error('   3. Verify STRIPE_TEST_SECRET_KEY is valid')
      console.error('   4. Ensure at least one agent and plan exist')
      console.error('   5. Ensure provider has Stripe Connect account configured')
      console.error('   6. Check that Stripe webhooks are configured')
      console.error('   7. See packages/server/README.md "Payment Integration Tests"')
      console.error()
      throw error
    }
  }, 30000) // 30s timeout for setup

  afterAll(async () => {
    if (!SOLVAPAY_SECRET_KEY || !STRIPE_TEST_SECRET_KEY) return

    console.log()
    console.log('═══════════════════════════════════════════════════════════')
    console.log('🧹 Payment test cleanup complete')
    console.log('═══════════════════════════════════════════════════════════')
    console.log()
  })

  beforeEach(() => {
    // Clear tasks before each test
    clearAllTasks()

    // Generate unique customer ref for each test to avoid conflicts
    testCustomerRef = `test_payment_${Date.now()}_${Math.random().toString(36).substring(7)}`
  })

  // ============================================================================
  // Test 1: Payment Intent Creation via Backend API
  // ============================================================================

  describe('Payment Intent - Creation via API', () => {
    it('should successfully create Stripe payment intent with clientSecret', async () => {
      if ((global as any).__SKIP_PAYMENT_TESTS__) {
        console.log('⏭️  Skipping: Stripe not configured')
        return
      }

      const planToUse = usageBasedPlan || defaultPlan

      console.log(`\n💳 Creating payment intent for plan: ${planToUse.name}`)

      // Ensure customer exists first
      const customerRef = await solvaPay.ensureCustomer(testCustomerRef)
      console.log(`✅ Customer created: ${customerRef}`)

      const paymentIntent = await createTestPaymentIntent(
        apiClient,
        defaultAgent.reference,
        planToUse.reference,
        customerRef,
      )

      expect(paymentIntent).toBeDefined()
      expect(paymentIntent).toHaveProperty('id')
      expect(paymentIntent).toHaveProperty('clientSecret')
      expect(paymentIntent).toHaveProperty('publishableKey')

      console.log(`✅ Payment intent created successfully:`, {
        id: paymentIntent.id,
        hasClientSecret: !!paymentIntent.clientSecret,
        hasPublishableKey: !!paymentIntent.publishableKey,
      })
    })

    it('should include Stripe Connect account ID when provider uses Connect', async () => {
      if ((global as any).__SKIP_PAYMENT_TESTS__) {
        console.log('⏭️  Skipping: Stripe not configured')
        return
      }

      const planToUse = usageBasedPlan || defaultPlan

      // Ensure customer exists first
      const customerRef = await solvaPay.ensureCustomer(testCustomerRef)
      console.log(`✅ Customer created: ${customerRef}`)

      const paymentIntent = await createTestPaymentIntent(
        apiClient,
        defaultAgent.reference,
        planToUse.reference,
        customerRef,
      )

      // accountId is optional (only for Stripe Connect)
      if (paymentIntent.accountId) {
        expect(typeof paymentIntent.accountId).toBe('string')
        console.log(`✅ Stripe Connect account ID present: ${paymentIntent.accountId}`)
      } else {
        console.log(`ℹ️  No Stripe Connect account ID (direct integration)`)
      }
    })
  })

  // ============================================================================
  // Test 2: Payment Confirmation Using Stripe Test Cards
  // ============================================================================

  describe('Payment Confirmation - Test Card Processing', () => {
    it('should successfully confirm payment using Stripe test card', async () => {
      if ((global as any).__SKIP_PAYMENT_TESTS__) {
        console.log('⏭️  Skipping: Stripe not configured')
        return
      }

      const planToUse = usageBasedPlan || defaultPlan

      // Step 1: Ensure customer exists
      const customerRef = await solvaPay.ensureCustomer(testCustomerRef)
      console.log(`✅ Customer created: ${customerRef}`)

      // Step 2: Create payment intent
      const paymentIntent = await createTestPaymentIntent(
        apiClient,
        defaultAgent.reference,
        planToUse.reference,
        customerRef,
      )

      // Step 3: Confirm payment with test card
      const confirmed = await confirmPaymentWithTestCard(
        stripeClient,
        paymentIntent.clientSecret,
        STRIPE_TEST_CARDS.VISA,
        paymentIntent.stripeAccountId, // Pass Stripe Connect account ID if available
      )

      expect(confirmed).toBeDefined()
      expect(confirmed.status).toBe('succeeded')
      // Note: confirmed.id is the Stripe payment intent ID (pi_xxx)
      // paymentIntent.id is the backend's internal ID (different)
      expect(confirmed.id).toMatch(/^pi_/) // Verify it's a Stripe payment intent ID

      console.log(`✅ Payment confirmed successfully:`, {
        id: confirmed.id,
        status: confirmed.status,
        amount: confirmed.amount,
        currency: confirmed.currency,
      })
    }, 30000) // 30s timeout for Stripe API calls
  })

  // ============================================================================
  // Test 3: Credit System - Granting & Deducting Usage Credits
  // ============================================================================

  describe('Credit Management - Free Units & Deduction', () => {
    it('should auto-create purchase with free units when plan has freeUnits > 0', async () => {
      if ((global as any).__SKIP_PAYMENT_TESTS__) {
        console.log('⏭️  Skipping: Stripe not configured')
        return
      }

      if (!usageBasedPlan || !usageBasedPlan.freeUnits || parseInt(usageBasedPlan.freeUnits) <= 0) {
        console.log('⏭️  Skipping: Default plan does not have freeUnits > 0')
        return
      }

      const planToUse = usageBasedPlan
      const freeUnitsExpected = parseInt(planToUse.freeUnits || '0')

      console.log(
        `\n📋 Testing purchase auto-creation: "${planToUse.name}" with ${freeUnitsExpected} free units`,
      )

      expect(planToUse.reference).toBeDefined()

      // Create customer and check purchase
      const testCustomerRef = `test_free_units_${Date.now()}_${Math.random().toString(36).substring(7)}`
      const customerRef = await solvaPay.ensureCustomer(testCustomerRef)

      const limitsCheck = await apiClient.checkLimits({
        customerRef: customerRef,
        agentRef: defaultAgent.reference,
      })

      expect(limitsCheck.remaining).toBeGreaterThanOrEqual(freeUnitsExpected)
      expect(limitsCheck.withinLimits).toBe(true)

      console.log(`✅ Purchase verified: ${limitsCheck.remaining} units available`)
    }, 15000)

    it('should deduct exactly 1 credit per trackUsage call', async () => {
      if ((global as any).__SKIP_PAYMENT_TESTS__) {
        console.log('⏭️  Skipping: Stripe not configured')
        return
      }

      if (!usageBasedPlan) {
        console.log('⏭️  Skipping: Default plan is not usage-based')
        return
      }

      const planToUse = usageBasedPlan
      console.log(`\n📋 Testing trackUsage credit deduction: "${planToUse.name}"`)

      expect(planToUse.reference).toBeDefined()

      // Create customer and check initial credits
      const customerRef = await solvaPay.ensureCustomer(testCustomerRef)
      const initialLimits = await apiClient.checkLimits({
        customerRef: customerRef,
        agentRef: defaultAgent.reference,
      })

      const creditsBeforeUsage = initialLimits.remaining
      expect(creditsBeforeUsage).toBeGreaterThan(0)

      // Track usage to deduct 1 credit
      await apiClient.trackUsage({
        customerRef: customerRef,
        agentRef: defaultAgent.reference,
        planRef: planToUse.reference,
        outcome: 'success',
        action: 'testAction',
        requestId: `req_track_usage_${Date.now()}`,
        actionDuration: 100,
        timestamp: new Date().toISOString(),
      })

      // Verify credit deduction
      const limitsAfterUsage = await apiClient.checkLimits({
        customerRef: customerRef,
        agentRef: defaultAgent.reference,
      })

      const creditsAfterUsage = limitsAfterUsage.remaining
      expect(creditsAfterUsage).toBe(creditsBeforeUsage - 1)

      console.log(
        `✅ trackUsage verified: 1 credit deducted (${creditsBeforeUsage} → ${creditsAfterUsage})`,
      )
    }, 15000)
  })

  // ============================================================================
  // Test 4: Complete E2E Flow - Payment to Credit Grant to Usage
  // ============================================================================

  describe('E2E Flow - Payment → Webhook → Credits → Usage', () => {
    it('should complete full cycle: payment intent → confirmation → webhook processing → credit grant → protected function access', async () => {
      // NOTE: This test requires Stripe webhooks to be properly forwarded to the backend.
      // To run this test:
      // 1. Ensure backend is running at localhost:3001
      // 2. Run: stripe listen --forward-to localhost:3001/webhooks/stripe
      // 3. Set ENABLE_WEBHOOK_TESTS=true
      // 4. Run the test suite: ENABLE_WEBHOOK_TESTS=true pnpm test:integration:payment
      //
      // Without webhook forwarding, the test will timeout waiting for credits to be granted.

      if ((global as any).__SKIP_PAYMENT_TESTS__) {
        console.log('⏭️  Skipping: Stripe not configured')
        return
      }

      if (!ENABLE_WEBHOOK_TESTS) {
        console.log('\n⏭️  Skipping E2E webhook test (webhook forwarding required)')
        console.log('   This test requires Stripe CLI webhook forwarding.')
        console.log('   To enable this test:')
        console.log('   1. Start your backend: cd backend && pnpm dev')
        console.log(
          '   2. Forward webhooks: stripe listen --forward-to localhost:3001/webhooks/stripe',
        )
        console.log('   3. Run with: ENABLE_WEBHOOK_TESTS=true pnpm test:integration:payment')
        console.log('   See packages/server/README.md for details.\n')
        return
      }

      const planToUse = usageBasedPlan || defaultPlan

      // Create customer and check initial limits
      const customerRef = await solvaPay.ensureCustomer(testCustomerRef)
      const initialLimits = await apiClient.checkLimits({
        customerRef: customerRef,
        agentRef: defaultAgent.reference,
      })
      const initialRemaining = initialLimits.remaining
      console.log(`\n📊 E2E Flow: Initial remaining units: ${initialRemaining}`)

      // Create and confirm payment intent
      const paymentIntent = await createTestPaymentIntent(
        apiClient,
        defaultAgent.reference,
        planToUse.reference,
        customerRef,
      )

      const confirmed = await confirmPaymentWithTestCard(
        stripeClient,
        paymentIntent.clientSecret,
        STRIPE_TEST_CARDS.VISA,
        paymentIntent.stripeAccountId,
      )
      console.log(
        `✅ Payment confirmed: ${confirmed.amount / 100} ${confirmed.currency.toUpperCase()}`,
      )

      // Wait for webhook to process
      const expectedMinUnits = initialRemaining + 1
      const updatedLimits = await waitForWebhookProcessing(
        apiClient,
        customerRef,
        defaultAgent.reference,
        planToUse.reference,
        expectedMinUnits,
        15000,
      )

      const creditsAdded = updatedLimits.remaining - initialRemaining
      console.log(
        `✅ Webhook processed: +${creditsAdded} units (${initialRemaining} → ${updatedLimits.remaining})`,
      )

      // Verify protected function access
      const payable = solvaPay.payable({
        agentRef: defaultAgent.reference,
        planRef: planToUse.reference,
      })
      const protectedHandler = await payable.function(createTask)

      const result = await protectedHandler({
        title: 'Post-Payment Test Task',
        description: 'This task should succeed after payment',
        auth: { customer_ref: testCustomerRef },
      })

      expect(result).toHaveProperty('success', true)
      expect(result.task).toHaveProperty('title', 'Post-Payment Test Task')

      // Verify usage deduction
      const limitsAfterUsage = await apiClient.checkLimits({
        customerRef: customerRef,
        agentRef: defaultAgent.reference,
      })

      expect(limitsAfterUsage.remaining).toBe(updatedLimits.remaining - 1)
      console.log(`✅ E2E flow complete: payment → webhook → ${creditsAdded} credits → 1 unit used`)
    }, 45000) // 45s timeout for full E2E flow
  })

  // ============================================================================
  // Test 5: Payment Failure Scenarios & Error Handling
  // ============================================================================

  describe('Payment Errors - Declined Cards & Failed Payments', () => {
    it('should properly handle declined test cards with appropriate errors', async () => {
      if ((global as any).__SKIP_PAYMENT_TESTS__) {
        console.log('⏭️  Skipping: Stripe not configured')
        return
      }

      const planToUse = usageBasedPlan || defaultPlan

      // Ensure customer exists first
      const customerRef = await solvaPay.ensureCustomer(testCustomerRef)
      console.log(`✅ Customer created: ${customerRef}`)

      // Create payment intent
      const paymentIntent = await createTestPaymentIntent(
        apiClient,
        defaultAgent.reference,
        planToUse.reference,
        customerRef,
      )

      // Try to confirm with declined test card
      await expect(
        confirmPaymentWithTestCard(
          stripeClient,
          paymentIntent.clientSecret,
          STRIPE_TEST_CARDS.DECLINED,
          paymentIntent.stripeAccountId, // Pass Stripe Connect account ID if available
        ),
      ).rejects.toThrow()

      console.log(`✅ Declined card error handled correctly`)
    }, 30000)

    it('should properly handle insufficient funds test card with appropriate errors', async () => {
      if ((global as any).__SKIP_PAYMENT_TESTS__) {
        console.log('⏭️  Skipping: Stripe not configured')
        return
      }

      const planToUse = usageBasedPlan || defaultPlan

      // Ensure customer exists first
      const customerRef = await solvaPay.ensureCustomer(testCustomerRef)
      console.log(`✅ Customer created: ${customerRef}`)

      // Create payment intent
      const paymentIntent = await createTestPaymentIntent(
        apiClient,
        defaultAgent.reference,
        planToUse.reference,
        customerRef,
      )

      // Try to confirm with insufficient funds test card
      await expect(
        confirmPaymentWithTestCard(
          stripeClient,
          paymentIntent.clientSecret,
          STRIPE_TEST_CARDS.INSUFFICIENT_FUNDS,
          paymentIntent.stripeAccountId, // Pass Stripe Connect account ID if available
        ),
      ).rejects.toThrow()

      console.log(`✅ Insufficient funds error handled correctly`)
    }, 30000)
  })
})

// If tests are skipped, show a helpful message
if (!USE_REAL_BACKEND || !SOLVAPAY_SECRET_KEY || !STRIPE_TEST_SECRET_KEY) {
  describe.skip('Payment Integration Tests - SKIPPED (Configuration Required)', () => {
    it('shows setup instructions for Stripe payment integration tests', () => {
      console.log('\n📋 To run payment integration tests:')
      console.log('   1. Set USE_REAL_BACKEND=true')
      console.log('   2. Set SOLVAPAY_SECRET_KEY=<your_secret_key>')
      console.log('   3. Set STRIPE_TEST_SECRET_KEY=<your_stripe_test_key>')
      console.log('   4. Optionally set SOLVAPAY_API_BASE_URL')
      console.log('   5. Optionally set STRIPE_WEBHOOK_SECRET')
      console.log('   6. Run: pnpm test:integration\n')
    })
  })
}
