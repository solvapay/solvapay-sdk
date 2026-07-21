import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SolvaPayError } from '@solvapay/core'
import { createSolvaPayClient } from '../src/client'
import { PaywallError } from '../src/paywall'
import {
  resetWasmCache,
  setWasmClientForTests,
  type WasmClientLike,
  type WasmClientMethod,
} from '../src/wasm'

const GROUP_A: WasmClientMethod[] = [
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

const GROUP_B: WasmClientMethod[] = [
  'createPaymentIntent',
  'createTopupPaymentIntent',
  'processPaymentIntent',
  'attachBusinessDetails',
  'activatePlan',
]

const GROUP_C: WasmClientMethod[] = [
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

const ALL_METHODS: WasmClientMethod[] = [...GROUP_A, ...GROUP_B, ...GROUP_C]

function fakeClient(overrides: Partial<WasmClientLike> = {}): WasmClientLike {
  const base = Object.fromEntries(
    ALL_METHODS.map(fn => [fn, vi.fn(async () => JSON.stringify({ ok: true, value: { fn } }))]),
  ) as WasmClientLike
  return { ...base, ...overrides }
}

describe('createSolvaPayClient Group A WASM dispatch', () => {
  const originalImpl = process.env.SOLVAPAY_IMPL
  const fetchMock = vi.fn()

  beforeEach(() => {
    delete process.env.SOLVAPAY_IMPL
    resetWasmCache()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    if (originalImpl === undefined) {
      delete process.env.SOLVAPAY_IMPL
    } else {
      process.env.SOLVAPAY_IMPL = originalImpl
    }
    resetWasmCache()
    vi.unstubAllGlobals()
  })

  it('dispatches each Group A method to WasmClient under SOLVAPAY_IMPL=rust', async () => {
    process.env.SOLVAPAY_IMPL = 'rust'
    const calls: Array<{ fn: string; args: string }> = []
    const wasm = fakeClient(
      Object.fromEntries(
        GROUP_A.map(fn => [
          fn,
          vi.fn(async (argsJson: string) => {
            calls.push({ fn, args: argsJson })
            return JSON.stringify({ ok: true, value: { fromWasm: fn } })
          }),
        ]),
      ) as Partial<WasmClientLike>,
    )
    setWasmClientForTests(wasm)

    const client = createSolvaPayClient({ apiKey: 'sk_test', apiBaseUrl: 'https://api.test' })

    expect(await client.createCustomer({ email: 'a@b.c' })).toEqual({
      fromWasm: 'createCustomer',
    })
    expect(await client.updateCustomer('cus_1', { name: 'Ada' })).toEqual({
      fromWasm: 'updateCustomer',
    })
    expect(await client.getCustomer({ customerRef: 'cus_1' })).toEqual({
      fromWasm: 'getCustomer',
    })
    expect(await client.assignCredits({ customerRef: 'cus_1', amount: 10 })).toEqual({
      fromWasm: 'assignCredits',
    })
    expect(await client.getCustomerBalance({ customerRef: 'cus_1' })).toEqual({
      fromWasm: 'getCustomerBalance',
    })
    expect(await client.getUserInfo({ customerRef: 'cus_1', productRef: 'prod_1' })).toEqual({
      fromWasm: 'getUserInfo',
    })
    expect(
      await client.createCheckoutSession({ customerRef: 'cus_1', productRef: 'prod_1' }),
    ).toEqual({ fromWasm: 'createCheckoutSession' })
    expect(await client.createCustomerSession({ customerRef: 'cus_1' })).toEqual({
      fromWasm: 'createCustomerSession',
    })
    expect(await client.getMerchant()).toEqual({ fromWasm: 'getMerchant' })
    expect(await client.getPlatformConfig()).toEqual({ fromWasm: 'getPlatformConfig' })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(calls.map(c => c.fn).sort()).toEqual([...GROUP_A].sort())

    const updateCall = calls.find(c => c.fn === 'updateCustomer')
    expect(updateCall?.args).toBe(JSON.stringify({ customerRef: 'cus_1', name: 'Ada' }))

    const createCall = calls.find(c => c.fn === 'createCustomer')
    expect(createCall?.args).toBe(JSON.stringify({ email: 'a@b.c' }))
  })

  it('returns envelope value unchanged (no TS re-normalization)', async () => {
    process.env.SOLVAPAY_IMPL = 'rust'
    const raw = { reference: 'cus_raw', customerRef: 'cus_mapped', extra: 1 }
    setWasmClientForTests(
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
    process.env.SOLVAPAY_IMPL = 'rust'
    setWasmClientForTests(
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
    process.env.SOLVAPAY_IMPL = 'rust'
    const gate = {
      kind: 'payment_required' as const,
      product: 'prod_1',
      checkoutUrl: 'https://checkout.example/x',
      message: 'Payment required',
    }
    setWasmClientForTests(
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

  it('uses TS fetch body under SOLVAPAY_IMPL=ts', async () => {
    process.env.SOLVAPAY_IMPL = 'ts'
    const createCustomer = vi.fn()
    setWasmClientForTests(fakeClient({ createCustomer }))

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ customerRef: 'cus_ts' }),
    })

    const client = createSolvaPayClient({ apiKey: 'sk_test', apiBaseUrl: 'https://api.test' })
    const result = await client.createCustomer({ email: 'a@b.c' })

    expect(result).toEqual({ customerRef: 'cus_ts' })
    expect(createCustomer).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('createSolvaPayClient Group B/C WASM dispatch', () => {
  const originalImpl = process.env.SOLVAPAY_IMPL
  const fetchMock = vi.fn()

  beforeEach(() => {
    delete process.env.SOLVAPAY_IMPL
    resetWasmCache()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    if (originalImpl === undefined) {
      delete process.env.SOLVAPAY_IMPL
    } else {
      process.env.SOLVAPAY_IMPL = originalImpl
    }
    resetWasmCache()
    vi.unstubAllGlobals()
  })

  it('dispatches each Group B/C method to WasmClient under SOLVAPAY_IMPL=rust', async () => {
    process.env.SOLVAPAY_IMPL = 'rust'
    const calls: Array<{ fn: string; args: string }> = []
    const groupBC = [...GROUP_B, ...GROUP_C]
    const wasm = fakeClient(
      Object.fromEntries(
        groupBC.map(fn => [
          fn,
          vi.fn(async (argsJson: string) => {
            calls.push({ fn, args: argsJson })
            return JSON.stringify({ ok: true, value: { fromWasm: fn } })
          }),
        ]),
      ) as Partial<WasmClientLike>,
    )
    setWasmClientForTests(wasm)

    const client = createSolvaPayClient({ apiKey: 'sk_test', apiBaseUrl: 'https://api.test' })

    expect(
      await client.createPaymentIntent!({
        productRef: 'prod_1',
        planRef: 'plan_1',
        customerRef: 'cus_1',
      }),
    ).toEqual({ fromWasm: 'createPaymentIntent' })
    expect(
      await client.createTopupPaymentIntent!({
        customerRef: 'cus_1',
        amount: 100,
        currency: 'usd',
      }),
    ).toEqual({ fromWasm: 'createTopupPaymentIntent' })
    expect(
      await client.processPaymentIntent!({
        paymentIntentId: 'pi_1',
        customerRef: 'cus_1',
      }),
    ).toEqual({ fromWasm: 'processPaymentIntent' })
    expect(
      await client.attachBusinessDetails!({
        paymentIntentId: 'pi_1',
        isBusiness: false,
      }),
    ).toEqual({ fromWasm: 'attachBusinessDetails' })
    expect(
      await client.activatePlan!({
        customerRef: 'cus_1',
        productRef: 'prod_1',
        planRef: 'plan_1',
      }),
    ).toEqual({ fromWasm: 'activatePlan' })

    expect(
      await client.checkLimits({ productRef: 'prod_1', resource: 'tool', units: 1 }),
    ).toEqual({ fromWasm: 'checkLimits' })
    expect(
      await client.trackUsage({
        customerRef: 'cus_1',
        productRef: 'prod_1',
        resource: 'tool',
        units: 1,
      }),
    ).toEqual({ fromWasm: 'trackUsage' })
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
    ).toEqual({ fromWasm: 'trackUsageBulk' })
    expect(await client.getProduct!('prod_1')).toEqual({ fromWasm: 'getProduct' })
    expect(await client.listProducts!()).toEqual({ fromWasm: 'listProducts' })
    expect(await client.createProduct!({ name: 'Widget' })).toEqual({
      fromWasm: 'createProduct',
    })
    expect(await client.updateProduct!('prod_1', { name: 'X' })).toEqual({
      fromWasm: 'updateProduct',
    })
    expect(await client.deleteProduct!('prod_1')).toEqual({ fromWasm: 'deleteProduct' })
    expect(await client.cloneProduct!('prod_1', { name: 'Clone' })).toEqual({
      fromWasm: 'cloneProduct',
    })
    expect(
      await client.bootstrapMcpProduct!({
        name: 'Docs',
        tools: [],
      }),
    ).toEqual({ fromWasm: 'bootstrapMcpProduct' })
    expect(await client.configureMcpPlans!('prod_1', { plans: [] })).toEqual({
      fromWasm: 'configureMcpPlans',
    })
    expect(await client.listPlans!('prod_1')).toEqual({ fromWasm: 'listPlans' })
    expect(
      await client.createPlan!({
        productRef: 'prod_1',
        name: 'Basic',
        price: 1000,
        currency: 'usd',
        type: 'recurring',
        billingCycle: 'month',
      }),
    ).toEqual({ fromWasm: 'createPlan' })
    expect(await client.updatePlan!('prod_1', 'plan_1', { name: 'Pro' })).toEqual({
      fromWasm: 'updatePlan',
    })
    expect(await client.deletePlan!('prod_1', 'plan_1')).toEqual({ fromWasm: 'deletePlan' })
    expect(await client.cancelPurchase!({ purchaseRef: 'pur_1' })).toEqual({
      fromWasm: 'cancelPurchase',
    })
    expect(await client.reactivatePurchase!({ purchaseRef: 'pur_1' })).toEqual({
      fromWasm: 'reactivatePurchase',
    })
    expect(await client.getPaymentMethod!({ customerRef: 'cus_1' })).toEqual({
      fromWasm: 'getPaymentMethod',
    })
    expect(await client.getAutoRecharge!({ customerRef: 'cus_1' })).toEqual({
      fromWasm: 'getAutoRecharge',
    })
    expect(
      await client.saveAutoRecharge!({
        customerRef: 'cus_1',
        enabled: true,
        thresholdAmount: 100,
        rechargeAmount: 500,
        currency: 'usd',
      }),
    ).toEqual({ fromWasm: 'saveAutoRecharge' })
    expect(await client.disableAutoRecharge!({ customerRef: 'cus_1' })).toEqual({
      fromWasm: 'disableAutoRecharge',
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
    process.env.SOLVAPAY_IMPL = 'rust'
    setWasmClientForTests(
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
