import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createSolvaPay, createSolvaPayClient } from '../src/index'
import {
  createMultiCurrencyPaidTestPlan,
  createTestProduct,
  deleteTestProduct,
} from '@solvapay/test-utils'

/**
 * Paid plan payment-intent integration tests.
 *
 * Composable pricings are single-currency. The former multi-currency
 * `pricingOptions` suite is reduced to verifying that a paid recurring plan
 * charges in the provider's default currency (and rejects an unsupported one).
 *
 * Prereqs (same as backend.integration.test.ts):
 *   USE_REAL_BACKEND=true
 *   SOLVAPAY_SECRET_KEY=<valid provider key>
 *   SOLVAPAY_API_BASE_URL=http://localhost:3010
 */

const USE_REAL_BACKEND = process.env.USE_REAL_BACKEND === 'true'
const SOLVAPAY_SECRET_KEY = process.env.SOLVAPAY_SECRET_KEY
const SOLVAPAY_API_BASE_URL = process.env.SOLVAPAY_API_BASE_URL

const describeIntegration =
  USE_REAL_BACKEND && SOLVAPAY_SECRET_KEY ? describe : describe.skip

/** Customer-facing charge in minor units (presentment currency). */
function presentmentAmount(intent: {
  amount: number
  originalAmount?: number
}): number {
  return intent.originalAmount ?? intent.amount
}

describeIntegration('Paid plan payment intents — Real Backend', () => {
  let apiClient: ReturnType<typeof createSolvaPayClient>
  let solvaPay: ReturnType<typeof createSolvaPay>
  let providerCurrency: string
  let testProduct: { reference: string; name: string }
  let paidPlan: {
    reference: string
    productRef: string
    currency: string
    price: number
  }

  const planPrice = 2500

  beforeAll(async () => {
    apiClient = createSolvaPayClient({
      apiKey: SOLVAPAY_SECRET_KEY!,
      apiBaseUrl: SOLVAPAY_API_BASE_URL,
    })
    solvaPay = createSolvaPay({ apiClient })

    const merchant = await apiClient.getMerchant()
    providerCurrency = (merchant?.defaultCurrency || 'USD').toUpperCase()

    const fixtureName = `SDK Paid Plan Fixture ${Date.now()}`
    const apiBaseUrl = SOLVAPAY_API_BASE_URL || 'https://api.solvapay.com'

    testProduct = await createTestProduct(apiBaseUrl, SOLVAPAY_SECRET_KEY!, fixtureName)

    paidPlan = await createMultiCurrencyPaidTestPlan(
      apiBaseUrl,
      SOLVAPAY_SECRET_KEY!,
      testProduct.reference,
      {
        defaultCurrency: providerCurrency,
        pricingOptions: [{ currency: providerCurrency, price: planPrice, default: true }],
      },
    )
  })

  afterAll(async () => {
    if (!SOLVAPAY_SECRET_KEY || !testProduct?.reference) return
    const apiBaseUrl = SOLVAPAY_API_BASE_URL || 'https://api.solvapay.com'
    await deleteTestProduct(apiBaseUrl, SOLVAPAY_SECRET_KEY, testProduct.reference)
  })

  it('listPlans returns the paid plan in the provider currency', async () => {
    const plans = await apiClient.listPlans!(testProduct.reference)
    const plan = plans.find(entry => entry.reference === paidPlan.reference)

    expect(plan).toBeDefined()
    expect(plan?.currency?.toUpperCase()).toBe(providerCurrency)
    expect(plan?.price).toBe(planPrice)
  })

  it('createPaymentIntent resolves the plan currency when currency is omitted', async () => {
    const customerRef = await solvaPay.ensureCustomer(`mc_default_${Date.now()}`)

    const intent = await apiClient.createPaymentIntent!({
      customerRef,
      productRef: testProduct.reference,
      planRef: paidPlan.reference,
    })

    expect(intent.currency?.toUpperCase()).toBe(providerCurrency)
    expect(presentmentAmount(intent)).toBe(planPrice)
    expect(intent.amount).toBeGreaterThan(0)
    expect(intent.clientSecret).toBeDefined()
    expect(intent.processorPaymentId).toBeDefined()
  })

  it('factory createPaymentIntent charges the plan price', async () => {
    const customerRef = await solvaPay.ensureCustomer(`mc_factory_${Date.now()}`)

    const intent = await solvaPay.createPaymentIntent({
      customerRef,
      productRef: testProduct.reference,
      planRef: paidPlan.reference,
    })

    expect(presentmentAmount(intent)).toBe(planPrice)
    expect(intent.currency?.toUpperCase()).toBe(providerCurrency)
  })

  it('falls back to the plan currency when an unsupported currency is requested', async () => {
    const customerRef = await solvaPay.ensureCustomer(`mc_invalid_${Date.now()}`)

    // Composable plans are single-currency; an unsupported presentment currency
    // is coerced to the plan/provider currency rather than rejected.
    const intent = await apiClient.createPaymentIntent!({
      customerRef,
      productRef: testProduct.reference,
      planRef: paidPlan.reference,
      currency: 'GBP',
    })

    expect(intent.currency?.toUpperCase()).toBe(providerCurrency)
    expect(presentmentAmount(intent)).toBe(planPrice)
  })
})

if (!USE_REAL_BACKEND || !SOLVAPAY_SECRET_KEY) {
  describe.skip('Paid plan payment intents — SKIPPED (Configuration Required)', () => {
    it('shows setup instructions', () => {
      console.log('\n📋 To run paid-plan integration tests:')
      console.log('   1. Set USE_REAL_BACKEND=true')
      console.log('   2. Set SOLVAPAY_SECRET_KEY=<your_secret_key>')
      console.log('   3. Optionally set SOLVAPAY_API_BASE_URL=http://localhost:3010')
      console.log('   4. Run: pnpm test:integration:multi-currency\n')
    })
  })
}
