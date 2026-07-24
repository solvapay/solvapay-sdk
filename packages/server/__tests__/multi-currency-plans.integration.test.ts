import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createSolvaPay, createSolvaPayClient, SolvaPayError } from '../src/index'
import {
  createMultiCurrencyPaidTestPlan,
  createTestProduct,
  deleteTestProduct,
} from '@solvapay/test-utils'

/**
 * Multi-Currency Plans — SDK ↔ Backend Integration Tests
 *
 * Verifies pricingOptions round-trip through plan APIs and that optional
 * `currency` on createPaymentIntent resolves the correct charge amount.
 *
 * Prereqs (same as backend.integration.test.ts):
 *   USE_REAL_BACKEND=true
 *   SOLVAPAY_SECRET_KEY=<valid provider key>
 *   SOLVAPAY_API_BASE_URL=http://localhost:3001
 */

const USE_REAL_BACKEND = process.env.USE_REAL_BACKEND === 'true'
const SOLVAPAY_SECRET_KEY = process.env.SOLVAPAY_SECRET_KEY
const SOLVAPAY_API_BASE_URL = process.env.SOLVAPAY_API_BASE_URL

const describeIntegration = USE_REAL_BACKEND && SOLVAPAY_SECRET_KEY ? describe : describe.skip

/** Customer-facing charge in minor units (presentment currency). */
function presentmentAmount(intent: { amount: number; originalAmount?: number }): number {
  return intent.originalAmount ?? intent.amount
}

describeIntegration('Multi-Currency Plans — Real Backend', () => {
  let apiClient: ReturnType<typeof createSolvaPayClient>
  let solvaPay: ReturnType<typeof createSolvaPay>
  let providerCurrency: string
  let secondaryCurrency: string
  let testProduct: { reference: string; name: string }
  let multiCurrencyPlan: {
    reference: string
    productRef: string
    currency: string
    price: number
    pricingOptions?: Array<{ currency: string; price: number; default?: boolean }>
  }

  let defaultOptionPrice = 2500
  let alternateOptionPrice = 2200

  beforeAll(async () => {
    apiClient = createSolvaPayClient({
      apiKey: SOLVAPAY_SECRET_KEY!,
      apiBaseUrl: SOLVAPAY_API_BASE_URL,
    })
    solvaPay = createSolvaPay({ apiClient })

    const merchant = await apiClient.getMerchant()
    providerCurrency = (merchant?.defaultCurrency || 'USD').toUpperCase()
    secondaryCurrency = providerCurrency === 'USD' ? 'EUR' : 'USD'

    const fixtureName = `SDK Multi-Currency Fixture ${Date.now()}`
    const apiBaseUrl = SOLVAPAY_API_BASE_URL || 'https://api.solvapay.com'

    testProduct = await createTestProduct(apiBaseUrl, SOLVAPAY_SECRET_KEY!, fixtureName)

    multiCurrencyPlan = await createMultiCurrencyPaidTestPlan(
      apiBaseUrl,
      SOLVAPAY_SECRET_KEY!,
      testProduct.reference,
      {
        defaultCurrency: providerCurrency,
        pricingOptions: [
          { currency: providerCurrency, price: defaultOptionPrice, default: true },
          { currency: secondaryCurrency, price: alternateOptionPrice },
        ],
      },
    )

    const listed = await apiClient.listPlans!(testProduct.reference)
    const storedPlan = listed.find(entry => entry.reference === multiCurrencyPlan.reference)
    const storedDefault = storedPlan?.pricingOptions?.find(option => option.default)
    const storedAlternate = storedPlan?.pricingOptions?.find(
      option => option.currency?.toUpperCase() === secondaryCurrency,
    )
    if (storedDefault?.price != null) defaultOptionPrice = storedDefault.price
    if (storedAlternate?.price != null) alternateOptionPrice = storedAlternate.price
  })

  afterAll(async () => {
    if (!SOLVAPAY_SECRET_KEY || !testProduct?.reference) return
    const apiBaseUrl = SOLVAPAY_API_BASE_URL || 'https://api.solvapay.com'
    await deleteTestProduct(apiBaseUrl, SOLVAPAY_SECRET_KEY, testProduct.reference)
  })

  it('listPlans returns pricingOptions for multi-currency plans', async () => {
    const plans = await apiClient.listPlans!(testProduct.reference)
    const plan = plans.find(entry => entry.reference === multiCurrencyPlan.reference)

    expect(plan).toBeDefined()
    expect(plan?.pricingOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currency: providerCurrency,
          price: defaultOptionPrice,
          default: true,
        }),
        expect.objectContaining({
          currency: secondaryCurrency,
          price: alternateOptionPrice,
        }),
      ]),
    )
    expect(plan?.currency?.toUpperCase()).toBe(providerCurrency)
    expect(plan?.price).toBe(defaultOptionPrice)
  })

  it('updatePlan can add pricingOptions to an existing paid plan', async () => {
    const apiBaseUrl = SOLVAPAY_API_BASE_URL || 'https://api.solvapay.com'
    const updatedName = `Updated Multi-Currency ${Date.now()}`

    const updated = await apiClient.updatePlan!(
      testProduct.reference,
      multiCurrencyPlan.reference,
      {
        name: updatedName,
        pricingOptions: [
          { currency: providerCurrency, price: defaultOptionPrice, default: true },
          { currency: secondaryCurrency, price: alternateOptionPrice },
        ],
      },
    )

    const plan = updated.data ?? updated
    expect(plan.name).toBe(updatedName)
    expect(plan.pricingOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currency: providerCurrency,
          price: defaultOptionPrice,
          default: true,
        }),
        expect.objectContaining({ currency: secondaryCurrency, price: alternateOptionPrice }),
      ]),
    )

    const listed = await apiClient.listPlans!(testProduct.reference)
    const listedPlan = listed.find(entry => entry.reference === multiCurrencyPlan.reference)
    expect(listedPlan?.pricingOptions?.length).toBe(2)
    expect(listedPlan?.name).toBe(updatedName)
    void apiBaseUrl
  })

  it('createPaymentIntent resolves default option currency when currency is omitted', async () => {
    const customerRef = await solvaPay.ensureCustomer(`mc_default_${Date.now()}`)

    const intent = await apiClient.createPaymentIntent!({
      customerRef,
      productRef: testProduct.reference,
      planRef: multiCurrencyPlan.reference,
    })

    expect(intent.currency?.toUpperCase()).toBe(providerCurrency)
    expect(presentmentAmount(intent)).toBe(defaultOptionPrice)
    expect(intent.amount).toBeGreaterThan(0)
    expect(intent.clientSecret).toBeDefined()
    expect(intent.processorPaymentId).toBeDefined()
  })

  it('createPaymentIntent with currency selects the matching pricing option', async () => {
    const customerRef = await solvaPay.ensureCustomer(`mc_eur_${Date.now()}`)

    const intent = await apiClient.createPaymentIntent!({
      customerRef,
      productRef: testProduct.reference,
      planRef: multiCurrencyPlan.reference,
      currency: secondaryCurrency,
    })

    expect(presentmentAmount(intent)).toBe(alternateOptionPrice)
    expect(intent.currency?.toUpperCase()).toBe(secondaryCurrency)
    expect(intent.clientSecret).toBeDefined()
  })

  it('createPaymentIntent default and explicit currency produce different charges', async () => {
    const defaultCustomer = await solvaPay.ensureCustomer(`mc_compare_default_${Date.now()}`)
    const altCustomer = await solvaPay.ensureCustomer(`mc_compare_alt_${Date.now()}`)

    const defaultIntent = await apiClient.createPaymentIntent!({
      customerRef: defaultCustomer,
      productRef: testProduct.reference,
      planRef: multiCurrencyPlan.reference,
    })
    const altIntent = await apiClient.createPaymentIntent!({
      customerRef: altCustomer,
      productRef: testProduct.reference,
      planRef: multiCurrencyPlan.reference,
      currency: secondaryCurrency,
    })

    expect(defaultIntent.currency?.toUpperCase()).toBe(providerCurrency)
    expect(altIntent.currency?.toUpperCase()).toBe(secondaryCurrency)
    expect(presentmentAmount(altIntent)).toBe(alternateOptionPrice)
    if (defaultOptionPrice !== alternateOptionPrice) {
      expect(presentmentAmount(defaultIntent)).not.toBe(presentmentAmount(altIntent))
    }
  })

  it('factory createPaymentIntent forwards currency to the backend', async () => {
    const customerRef = await solvaPay.ensureCustomer(`mc_factory_${Date.now()}`)

    const intent = await solvaPay.createPaymentIntent({
      customerRef,
      productRef: testProduct.reference,
      planRef: multiCurrencyPlan.reference,
      currency: secondaryCurrency,
    })

    expect(presentmentAmount(intent)).toBe(alternateOptionPrice)
    expect(intent.currency?.toUpperCase()).toBe(secondaryCurrency)
  })

  it('rejects unsupported currency on createPaymentIntent', async () => {
    const customerRef = await solvaPay.ensureCustomer(`mc_invalid_${Date.now()}`)

    await expect(
      apiClient.createPaymentIntent!({
        customerRef,
        productRef: testProduct.reference,
        planRef: multiCurrencyPlan.reference,
        currency: 'GBP',
      }),
    ).rejects.toThrow(SolvaPayError)
  })
})

if (!USE_REAL_BACKEND || !SOLVAPAY_SECRET_KEY) {
  describe.skip('Multi-Currency Plans Integration — SKIPPED (Configuration Required)', () => {
    it('shows setup instructions', () => {
      console.log('\n📋 To run multi-currency integration tests:')
      console.log('   1. Set USE_REAL_BACKEND=true')
      console.log('   2. Set SOLVAPAY_SECRET_KEY=<your_secret_key>')
      console.log('   3. Optionally set SOLVAPAY_API_BASE_URL=http://localhost:3001')
      console.log('   4. Run: pnpm test:integration:multi-currency\n')
    })
  })
}
