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
      email: 'ada@acme.test',
      name: 'Ada',
      purchases: [
        {
          status: 'active',
          productRef: 'prd_test',
          reference: 'pur_1',
          planSnapshot: { isMetered: true, name: 'Pro' },
          usage: { periodStart: '2026-09-01T00:00:00.000Z' },
        },
      ],
    }),
    getPlatformConfig: vi.fn().mockResolvedValue({}),
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
  it('does not read platform config: the card fields need no processor key', async () => {
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

    expect(client.getPlatformConfig).not.toHaveBeenCalled()
    expect(Object.keys(payload).sort()).toStrictEqual(
      [
        'autoRechargeUrl',
        'checkoutUrl',
        'customer',
        'merchant',
        'plans',
        'portalUrl',
        'product',
        'productRef',
        'returnUrl',
        'view',
      ].sort(),
    )
  })

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
    expect(payload.customer?.email).toBe('ada@acme.test')
    expect(payload.customer?.name).toBe('Ada')
    expect(payload.customer?.canCall).toBe(true)
    expect(payload.customer?.remainingCalls).toBe(3800)
    expect(payload.customer?.nextAction).toBeUndefined()
    expect(payload.customer?.isCreditBased).toBe(false)
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
    expect(payload.customer?.usage).toMatchObject({ used: null, remaining: 0, total: null })
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
    expect(payload.customer?.nextAction).toBeUndefined()
    expect(payload.customer?.isCreditBased).toBe(true)
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
    expect(payload.portalUrl).toBe('https://example.test/portal')
    expect(payload.autoRechargeUrl).toBe(
      'https://example.test/portal?tab=credits&intent=autorecharge',
    )
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

  it('refetches purchases when limits.purchaseRef is missing from the first snapshot', async () => {
    const client = makeClient()
    const enrolled = {
      status: 'active',
      productRef: 'prd_test',
      reference: 'pur_enrolled',
      planSnapshot: { isMetered: false, name: 'Free' },
    }
    client.getCustomer
      .mockResolvedValueOnce({
        customerRef: 'cus_42',
        externalRef: 'cus_42',
        purchases: [],
      })
      .mockResolvedValue({
        customerRef: 'cus_42',
        externalRef: 'cus_42',
        purchases: [enrolled],
      })
    client.checkLimits.mockResolvedValue({
      remaining: 3,
      withinLimits: true,
      meterName: 'requests',
      activationRequired: false,
      used: 0,
      limit: 3,
      planRef: 'pln_free',
      purchaseRef: 'pur_enrolled',
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

    expect(payload.customer?.purchase?.purchases).toEqual(
      expect.arrayContaining([expect.objectContaining({ reference: 'pur_enrolled' })]),
    )
    expect(client.getCustomer.mock.calls.length).toBeGreaterThan(1)
  })

  it('leaves the customer null for an anonymous caller', async () => {
    const client = makeClient()
    const solvaPay = createSolvaPay({ apiClient: client as unknown as SolvaPayClient })
    const build = createBuildBootstrapPayload({
      solvaPay,
      productRef: 'prd_test',
      publicBaseUrl: 'https://example.test',
      getCustomerRef: () => 'anonymous',
    })

    const payload = await build('account', undefined)

    expect(payload.customer).toBeNull()
    expect(payload.checkoutUrl).toBeNull()
    expect(client.checkLimits).not.toHaveBeenCalled()
    expect(client.getCustomer).not.toHaveBeenCalled()
    expect(client.createCheckoutSession).not.toHaveBeenCalled()
  })

  it('leaves the customer null when no customer ref is present', async () => {
    const client = makeClient()
    const solvaPay = createSolvaPay({ apiClient: client as unknown as SolvaPayClient })
    const build = createBuildBootstrapPayload({
      solvaPay,
      productRef: 'prd_test',
      publicBaseUrl: 'https://example.test',
      getCustomerRef: () => null,
    })

    const payload = await build('account', undefined)

    expect(payload.customer).toBeNull()
    expect(client.checkLimits).not.toHaveBeenCalled()
  })
})
