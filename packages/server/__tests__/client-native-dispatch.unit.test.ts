import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SolvaPayError } from '@solvapay/core'
import { createSolvaPayClient } from '../src/client'
import { PaywallError } from '../src/paywall'
import {
  resetNativeCache,
  setNativeClientForTests,
  type NativeClientLike,
  type NativeClientMethod,
} from '../src/native'

const GROUP_A: NativeClientMethod[] = [
  'createCustomer',
  'updateCustomer',
  'getCustomer',
  'assignCredits',
  'getCustomerBalance',
  'getUserInfo',
  'createCheckoutSession',
  'createCustomerSession',
  'getMerchant',
  'getPlatformConfig',
]

const GROUP_B: NativeClientMethod[] = [
  'createPaymentIntent',
  'createTopupPaymentIntent',
  'processPaymentIntent',
  'attachBusinessDetails',
  'activatePlan',
]

const GROUP_C: NativeClientMethod[] = [
  'checkLimits',
  'trackUsage',
  'trackUsageBulk',
  'getProduct',
  'listProducts',
  'createProduct',
  'updateProduct',
  'deleteProduct',
  'cloneProduct',
  'bootstrapMcpProduct',
  'configureMcpPlans',
  'listPlans',
  'createPlan',
  'updatePlan',
  'deletePlan',
  'cancelPurchase',
  'reactivatePurchase',
  'getPaymentMethod',
  'getAutoRecharge',
  'saveAutoRecharge',
  'disableAutoRecharge',
]

const ALL_METHODS: NativeClientMethod[] = [...GROUP_A, ...GROUP_B, ...GROUP_C]

function fakeClient(overrides: Partial<NativeClientLike> = {}): NativeClientLike {
  const base = Object.fromEntries(
    ALL_METHODS.map(fn => [fn, vi.fn(async () => JSON.stringify({ ok: true, value: { fn } }))]),
  ) as NativeClientLike
  return { ...base, ...overrides }
}

describe('createSolvaPayClient Group A native dispatch', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    resetNativeCache()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    resetNativeCache()
    vi.unstubAllGlobals()
  })

  it('dispatches each Group A method to NativeClient', async () => {
    const calls: Array<{ fn: string; args: string }> = []
    const native = fakeClient(
      Object.fromEntries(
        GROUP_A.map(fn => [
          fn,
          vi.fn(async (argsJson: string) => {
            calls.push({ fn, args: argsJson })
            return JSON.stringify({ ok: true, value: { fromNative: fn } })
          }),
        ]),
      ) as Partial<NativeClientLike>,
    )
    setNativeClientForTests(native)

    const client = createSolvaPayClient({ apiKey: 'sk_test', apiBaseUrl: 'https://api.test' })

    expect(await client.createCustomer({ email: 'a@b.c' })).toEqual({
      fromNative: 'createCustomer',
    })
    expect(await client.updateCustomer('cus_1', { name: 'Ada' })).toEqual({
      fromNative: 'updateCustomer',
    })
    expect(await client.getCustomer({ customerRef: 'cus_1' })).toEqual({
      fromNative: 'getCustomer',
    })
    expect(await client.assignCredits({ customerRef: 'cus_1', amount: 10 })).toEqual({
      fromNative: 'assignCredits',
    })
    expect(await client.getCustomerBalance({ customerRef: 'cus_1' })).toEqual({
      fromNative: 'getCustomerBalance',
    })
    expect(await client.getUserInfo({ customerRef: 'cus_1', productRef: 'prod_1' })).toEqual({
      fromNative: 'getUserInfo',
    })
    expect(
      await client.createCheckoutSession({ customerRef: 'cus_1', productRef: 'prod_1' }),
    ).toEqual({ fromNative: 'createCheckoutSession' })
    expect(await client.createCustomerSession({ customerRef: 'cus_1' })).toEqual({
      fromNative: 'createCustomerSession',
    })
    expect(await client.getMerchant()).toEqual({ fromNative: 'getMerchant' })
    expect(await client.getPlatformConfig()).toEqual({ fromNative: 'getPlatformConfig' })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(calls.map(c => c.fn).sort()).toEqual([...GROUP_A].sort())

    const updateCall = calls.find(c => c.fn === 'updateCustomer')
    expect(updateCall?.args).toBe(JSON.stringify({ customerRef: 'cus_1', name: 'Ada' }))

    const createCall = calls.find(c => c.fn === 'createCustomer')
    expect(createCall?.args).toBe(JSON.stringify({ email: 'a@b.c' }))
  })

  it('returns envelope value unchanged (no TS re-normalization)', async () => {
    const raw = { reference: 'cus_raw', customerRef: 'cus_mapped', extra: 1 }
    setNativeClientForTests(
      fakeClient({
        createCustomer: vi.fn(async () => JSON.stringify({ ok: true, value: raw })),
      }),
    )

    const client = createSolvaPayClient({ apiKey: 'sk_test' })
    const result = await client.createCustomer({ email: 'a@b.c' })
    expect(result).toEqual(raw)
    expect(result).not.toEqual({ customerRef: 'cus_raw' })
  })

  it('propagates reconstructed SolvaPayError from Api envelope', async () => {
    setNativeClientForTests(
      fakeClient({
        getMerchant: vi.fn(async () =>
          JSON.stringify({
            ok: false,
            error: {
              kind: 'Api',
              message: 'Get merchant failed (401): nope',
              status: 401,
              code: null,
            },
          }),
        ),
      }),
    )

    const client = createSolvaPayClient({ apiKey: 'sk_test' })
    await expect(client.getMerchant()).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(SolvaPayError)
      expect((err as SolvaPayError).message).toBe('Get merchant failed (401): nope')
      expect((err as SolvaPayError).status).toBe(401)
      return true
    })
  })

  it('propagates reconstructed PaywallError from Paywall envelope', async () => {
    const gate = {
      kind: 'payment_required' as const,
      product: 'prod_1',
      checkoutUrl: 'https://checkout.example/x',
      message: 'Payment required',
    }
    setNativeClientForTests(
      fakeClient({
        getUserInfo: vi.fn(async () =>
          JSON.stringify({
            ok: false,
            error: { kind: 'Paywall', message: 'Payment required', gate },
          }),
        ),
      }),
    )

    const client = createSolvaPayClient({ apiKey: 'sk_test' })
    await expect(
      client.getUserInfo({ customerRef: 'cus_1', productRef: 'prod_1' }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(PaywallError)
      expect((err as PaywallError).structuredContent).toEqual(gate)
      return true
    })
  })

  it('throws when the native client binding is missing', async () => {
    setNativeClientForTests(null)

    const client = createSolvaPayClient({ apiKey: 'sk_test', apiBaseUrl: 'https://api.test' })

    await expect(client.createCustomer({ email: 'a@b.c' })).rejects.toBeInstanceOf(SolvaPayError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('createSolvaPayClient Group B/C native dispatch', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    resetNativeCache()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    resetNativeCache()
    vi.unstubAllGlobals()
  })

  it('dispatches each Group B/C method to NativeClient', async () => {
    const calls: Array<{ fn: string; args: string }> = []
    const groupBC = [...GROUP_B, ...GROUP_C]
    const native = fakeClient(
      Object.fromEntries(
        groupBC.map(fn => [
          fn,
          vi.fn(async (argsJson: string) => {
            calls.push({ fn, args: argsJson })
            return JSON.stringify({ ok: true, value: { fromNative: fn } })
          }),
        ]),
      ) as Partial<NativeClientLike>,
    )
    setNativeClientForTests(native)

    const client = createSolvaPayClient({ apiKey: 'sk_test', apiBaseUrl: 'https://api.test' })

    expect(
      await client.createPaymentIntent!({
        productRef: 'prod_1',
        planRef: 'plan_1',
        customerRef: 'cus_1',
      }),
    ).toEqual({ fromNative: 'createPaymentIntent' })
    expect(
      await client.createTopupPaymentIntent!({
        customerRef: 'cus_1',
        amount: 100,
        currency: 'usd',
      }),
    ).toEqual({ fromNative: 'createTopupPaymentIntent' })
    expect(
      await client.processPaymentIntent!({
        paymentIntentId: 'pi_1',
        customerRef: 'cus_1',
      }),
    ).toEqual({ fromNative: 'processPaymentIntent' })
    expect(
      await client.attachBusinessDetails!({
        paymentIntentId: 'pi_1',
        isBusiness: false,
      }),
    ).toEqual({ fromNative: 'attachBusinessDetails' })
    expect(
      await client.activatePlan!({
        customerRef: 'cus_1',
        productRef: 'prod_1',
        planRef: 'plan_1',
      }),
    ).toEqual({ fromNative: 'activatePlan' })

    expect(await client.checkLimits({ productRef: 'prod_1', resource: 'tool', units: 1 })).toEqual({
      fromNative: 'checkLimits',
    })
    expect(
      await client.trackUsage({
        customerRef: 'cus_1',
        productRef: 'prod_1',
        resource: 'tool',
        units: 1,
      }),
    ).toEqual({ fromNative: 'trackUsage' })
    expect(
      await client.trackUsageBulk!({
        usages: [
          {
            customerRef: 'cus_1',
            productRef: 'prod_1',
            resource: 'tool',
            units: 1,
          },
        ],
      }),
    ).toEqual({ fromNative: 'trackUsageBulk' })
    expect(await client.getProduct!('prod_1')).toEqual({ fromNative: 'getProduct' })
    expect(await client.listProducts!()).toEqual({ fromNative: 'listProducts' })
    expect(await client.createProduct!({ name: 'Widget' })).toEqual({
      fromNative: 'createProduct',
    })
    expect(await client.updateProduct!('prod_1', { name: 'X' })).toEqual({
      fromNative: 'updateProduct',
    })
    expect(await client.deleteProduct!('prod_1')).toEqual({ fromNative: 'deleteProduct' })
    expect(await client.cloneProduct!('prod_1', { name: 'Clone' })).toEqual({
      fromNative: 'cloneProduct',
    })
    expect(
      await client.bootstrapMcpProduct!({
        name: 'Docs',
        tools: [],
      }),
    ).toEqual({ fromNative: 'bootstrapMcpProduct' })
    expect(await client.configureMcpPlans!('prod_1', { plans: [] })).toEqual({
      fromNative: 'configureMcpPlans',
    })
    expect(await client.listPlans!('prod_1')).toEqual({ fromNative: 'listPlans' })
    expect(
      await client.createPlan!({
        productRef: 'prod_1',
        name: 'Basic',
        price: 1000,
        currency: 'usd',
        type: 'recurring',
        billingCycle: 'month',
      }),
    ).toEqual({ fromNative: 'createPlan' })
    expect(await client.updatePlan!('prod_1', 'plan_1', { name: 'Pro' })).toEqual({
      fromNative: 'updatePlan',
    })
    expect(await client.deletePlan!('prod_1', 'plan_1')).toEqual({ fromNative: 'deletePlan' })
    expect(await client.cancelPurchase!({ purchaseRef: 'pur_1' })).toEqual({
      fromNative: 'cancelPurchase',
    })
    expect(await client.reactivatePurchase!({ purchaseRef: 'pur_1' })).toEqual({
      fromNative: 'reactivatePurchase',
    })
    expect(await client.getPaymentMethod!({ customerRef: 'cus_1' })).toEqual({
      fromNative: 'getPaymentMethod',
    })
    expect(await client.getAutoRecharge!({ customerRef: 'cus_1' })).toEqual({
      fromNative: 'getAutoRecharge',
    })
    expect(
      await client.saveAutoRecharge!({
        customerRef: 'cus_1',
        enabled: true,
        thresholdAmount: 100,
        rechargeAmount: 500,
        currency: 'usd',
      }),
    ).toEqual({ fromNative: 'saveAutoRecharge' })
    expect(await client.disableAutoRecharge!({ customerRef: 'cus_1' })).toEqual({
      fromNative: 'disableAutoRecharge',
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(calls.map(c => c.fn).sort()).toEqual([...groupBC].sort())

    expect(calls.find(c => c.fn === 'getProduct')?.args).toBe(
      JSON.stringify({ productRef: 'prod_1' }),
    )
    expect(calls.find(c => c.fn === 'updateProduct')?.args).toBe(
      JSON.stringify({ productRef: 'prod_1', name: 'X' }),
    )
    expect(calls.find(c => c.fn === 'updatePlan')?.args).toBe(
      JSON.stringify({ productRef: 'prod_1', planRef: 'plan_1', name: 'Pro' }),
    )
    expect(calls.find(c => c.fn === 'deletePlan')?.args).toBe(
      JSON.stringify({ productRef: 'prod_1', planRef: 'plan_1' }),
    )
    expect(calls.find(c => c.fn === 'configureMcpPlans')?.args).toBe(
      JSON.stringify({ productRef: 'prod_1', plans: [] }),
    )
    expect(calls.find(c => c.fn === 'listPlans')?.args).toBe(
      JSON.stringify({ productRef: 'prod_1' }),
    )
    expect(calls.find(c => c.fn === 'cloneProduct')?.args).toBe(
      JSON.stringify({ productRef: 'prod_1', name: 'Clone' }),
    )
    expect(calls.find(c => c.fn === 'listProducts')?.args).toBe(JSON.stringify({}))
  })

  it('deleteProduct/deletePlan return null from null-envelope value', async () => {
    setNativeClientForTests(
      fakeClient({
        deleteProduct: vi.fn(async () => JSON.stringify({ ok: true, value: null })),
        deletePlan: vi.fn(async () => JSON.stringify({ ok: true, value: null })),
      }),
    )

    const client = createSolvaPayClient({ apiKey: 'sk_test' })
    expect(await client.deleteProduct!('prod_1')).toBeNull()
    expect(await client.deletePlan!('prod_1', 'plan_1')).toBeNull()
  })
})
