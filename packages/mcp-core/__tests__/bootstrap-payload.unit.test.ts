import { describe, expect, it, vi } from 'vitest'
import { createSolvaPay, type SolvaPayClient } from '@solvapay/server'
import { createBuildBootstrapPayload } from '../src'

function makeClient() {
  return {
    checkLimits: vi.fn().mockResolvedValue({
      remaining: 3800,
      withinLimits: true,
      meterName: 'requests',
      activationRequired: false,
      used: 6200,
      limit: 10000,
    }),
    trackUsage: vi.fn(),
    createCustomer: vi.fn().mockResolvedValue({ customerRef: 'cus_42' }),
    getCustomer: vi.fn().mockResolvedValue({
      customerRef: 'cus_42',
      externalRef: 'cus_42',
      purchases: [
        {
          status: 'active',
          productRef: 'prd_test',
          reference: 'pur_1',
          planSnapshot: { isMetered: true, name: 'Pro' },
          usage: { used: 6200 },
        },
      ],
    }),
    getPlatformConfig: vi.fn().mockResolvedValue({ stripePublishableKey: 'pk_test' }),
    getMerchant: vi.fn().mockResolvedValue({ displayName: 'Acme', legalName: 'Acme Inc' }),
    getProduct: vi.fn().mockResolvedValue({ reference: 'prd_test', name: 'Widget' }),
    listPlans: vi.fn().mockResolvedValue([{ reference: 'pln_pro', name: 'Pro' }]),
    getCustomerBalance: vi.fn().mockResolvedValue({
      customerRef: 'cus_42',
      credits: 0,
      displayCurrency: 'USD',
      creditsPerMinorUnit: 1,
      displayExchangeRate: 1,
    }),
    getPaymentMethod: vi.fn().mockResolvedValue({ kind: 'none' }),
    createCheckoutSession: vi.fn().mockResolvedValue({
      sessionId: 'sess',
      checkoutUrl: 'https://example.test/checkout',
    }),
    createCustomerSession: vi.fn().mockResolvedValue({
      sessionId: 'csess',
      customerUrl: 'https://example.test/portal',
    }),
  }
}

describe('createBuildBootstrapPayload', () => {
  it('always fetches limits once and derives usage from that result', async () => {
    const client = makeClient()
    const solvaPay = createSolvaPay({ apiClient: client as unknown as SolvaPayClient })
    const build = createBuildBootstrapPayload({
      solvaPay,
      productRef: 'prd_test',
      publicBaseUrl: 'https://example.test',
      getCustomerRef: () => 'cus_42',
    })

    const payload = await build('account', {
      authInfo: { extra: { customer_ref: 'cus_42' } },
    })

    expect(client.checkLimits).toHaveBeenCalledTimes(1)
    expect(payload.customer?.limits).toMatchObject({
      remaining: 3800,
      withinLimits: true,
      meterName: 'requests',
    })
    expect(payload.customer?.canCall).toBe(true)
    expect(payload.customer?.remainingCalls).toBe(3800)
    expect(payload.customer?.nextAction).toBeDefined()
    expect(payload.customer?.usage).toMatchObject({
      used: 6200,
      remaining: 3800,
      total: 10000,
      meterRef: 'requests',
      purchaseRef: 'pur_1',
    })
  })

  it('still fetches limits when there is no active purchase (state H)', async () => {
    const client = makeClient()
    client.getCustomer.mockResolvedValue({
      customerRef: 'cus_42',
      externalRef: 'cus_42',
      purchases: [],
    })
    client.checkLimits.mockResolvedValue({
      remaining: 0,
      withinLimits: false,
      meterName: 'requests',
      activationRequired: true,
    })
    const solvaPay = createSolvaPay({ apiClient: client as unknown as SolvaPayClient })
    const build = createBuildBootstrapPayload({
      solvaPay,
      productRef: 'prd_test',
      publicBaseUrl: 'https://example.test',
      getCustomerRef: () => 'cus_42',
    })

    const payload = await build('account', {
      authInfo: { extra: { customer_ref: 'cus_42' } },
    })

    expect(client.checkLimits).toHaveBeenCalledTimes(1)
    expect(payload.customer?.limits).toMatchObject({ activationRequired: true, remaining: 0 })
    expect(payload.customer?.usage).toMatchObject({ used: 0, remaining: 0, total: null })
  })

  it('succeeds on a credit-based allow response that has no plan field', async () => {
    const client = makeClient()
    client.checkLimits.mockResolvedValue({
      remaining: 15132,
      withinLimits: true,
      creditBalance: 3026427,
      creditsPerUnit: 200,
      balance: {
        creditBalance: 3026427,
        creditsPerUnit: 200,
        remainingUnits: 15132,
        currency: 'USD',
      },
    })
    const solvaPay = createSolvaPay({ apiClient: client as unknown as SolvaPayClient })
    const build = createBuildBootstrapPayload({
      solvaPay,
      productRef: 'prd_test',
      publicBaseUrl: 'https://example.test',
      getCustomerRef: () => 'cus_42',
    })

    const payload = await build('account', {
      authInfo: { extra: { customer_ref: 'cus_42' } },
    })

    expect(payload.customer?.canCall).toBe(true)
    expect(payload.customer?.remainingCalls).toBe(15132)
    expect(payload.customer?.creditsPerCall).toBe(200)
    expect(payload.customer?.nextAction).toBeDefined()
    expect(payload.customer?.limits).not.toHaveProperty('plan')
  })

  it('mints a credit-topup checkout session for view topup', async () => {
    const client = makeClient()
    const solvaPay = createSolvaPay({ apiClient: client as unknown as SolvaPayClient })
    const build = createBuildBootstrapPayload({
      solvaPay,
      productRef: 'prd_test',
      publicBaseUrl: 'https://example.test',
      getCustomerRef: () => 'cus_42',
    })

    await build('topup', {
      authInfo: { extra: { customer_ref: 'cus_42' } },
    })

    expect(client.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'credit_topup' }),
    )
  })

  it('mints a credit-topup checkout session when limits report topup_required', async () => {
    const client = makeClient()
    client.checkLimits.mockResolvedValue({
      remaining: 0,
      withinLimits: false,
      paywallReason: 'topup_required',
      creditBalance: 91_000,
      creditsPerUnit: 100_000,
      currency: 'USD',
    })
    const solvaPay = createSolvaPay({ apiClient: client as unknown as SolvaPayClient })
    const build = createBuildBootstrapPayload({
      solvaPay,
      productRef: 'prd_test',
      publicBaseUrl: 'https://example.test',
      getCustomerRef: () => 'cus_42',
    })

    await build('account', {
      authInfo: { extra: { customer_ref: 'cus_42' } },
    })

    expect(client.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'credit_topup' }),
    )
  })

  it('mints a product checkout session for explicit checkout view during a credit shortfall', async () => {
    const client = makeClient()
    client.checkLimits.mockResolvedValue({
      remaining: 0,
      withinLimits: false,
      paywallReason: 'topup_required',
      creditBalance: 91_000,
      creditsPerUnit: 100_000,
      currency: 'USD',
    })
    const solvaPay = createSolvaPay({ apiClient: client as unknown as SolvaPayClient })
    const build = createBuildBootstrapPayload({
      solvaPay,
      productRef: 'prd_test',
      publicBaseUrl: 'https://example.test',
      getCustomerRef: () => 'cus_42',
    })

    await build('checkout', {
      authInfo: { extra: { customer_ref: 'cus_42' } },
    })

    expect(client.createCheckoutSession).toHaveBeenCalledWith(
      expect.not.objectContaining({ purpose: 'credit_topup' }),
    )
  })

  it('mints a hosted checkout session with no returnUrl', async () => {
    const client = makeClient()
    const solvaPay = createSolvaPay({ apiClient: client as unknown as SolvaPayClient })
    const build = createBuildBootstrapPayload({
      solvaPay,
      productRef: 'prd_test',
      publicBaseUrl: 'https://mcp.example.test',
      getCustomerRef: () => 'cus_42',
    })

    const payload = await build('account', {
      authInfo: { extra: { customer_ref: 'cus_42' } },
    })

    expect(client.createCheckoutSession).toHaveBeenCalledWith(
      expect.not.objectContaining({ returnUrl: expect.anything() }),
    )
    expect(client.createCheckoutSession.mock.calls[0][0]).not.toHaveProperty('returnUrl')
    expect(payload.returnUrl).toBe('https://mcp.example.test')
  })

  it('does not mint a credit-topup session for the auto-recharge view', async () => {
    const client = makeClient()
    const solvaPay = createSolvaPay({ apiClient: client as unknown as SolvaPayClient })
    const build = createBuildBootstrapPayload({
      solvaPay,
      productRef: 'prd_test',
      publicBaseUrl: 'https://mcp.example.test',
      getCustomerRef: () => 'cus_42',
    })

    await build('auto-recharge', {
      authInfo: { extra: { customer_ref: 'cus_42' } },
    })

    expect(client.createCheckoutSession).toHaveBeenCalledWith(
      expect.not.objectContaining({ purpose: 'credit_topup' }),
    )
  })
})
