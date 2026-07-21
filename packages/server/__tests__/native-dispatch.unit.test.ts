import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SolvaPayError } from '@solvapay/core'
import { PaywallError } from '../src/paywall'
import {
  callNative,
  callNativeSync,
  resetNativeCache,
  resolveImpl,
  setNativeBindingForTests,
  setNativeClientForTests,
  type NativeClientLike,
  type NativeClientMethod,
} from '../src/native'

const ALL_METHODS: NativeClientMethod[] = [
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
  'createPaymentIntent',
  'createTopupPaymentIntent',
  'processPaymentIntent',
  'attachBusinessDetails',
  'activatePlan',
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

function fakeClient(overrides: Partial<NativeClientLike> = {}): NativeClientLike {
  const base = Object.fromEntries(
    ALL_METHODS.map(fn => [fn, vi.fn()]),
  ) as NativeClientLike
  return { ...base, ...overrides }
}

describe('native.ts dispatch + envelope reconstructor', () => {
  const originalImpl = process.env.SOLVAPAY_IMPL

  beforeEach(() => {
    delete process.env.SOLVAPAY_IMPL
    resetNativeCache()
  })

  afterEach(() => {
    if (originalImpl === undefined) {
      delete process.env.SOLVAPAY_IMPL
    } else {
      process.env.SOLVAPAY_IMPL = originalImpl
    }
    resetNativeCache()
  })

  it('resolveImpl(client) returns ts when SOLVAPAY_IMPL=ts', () => {
    process.env.SOLVAPAY_IMPL = 'ts'
    expect(resolveImpl('client')).toBe('ts')
  })

  it('resolveImpl(client) returns rust when SOLVAPAY_IMPL=rust', () => {
    process.env.SOLVAPAY_IMPL = 'rust'
    expect(resolveImpl('client')).toBe('rust')
  })

  it('resolveImpl(client) prefers rust by default when the binding loads', () => {
    setNativeBindingForTests({
      verifyWebhook: () => '{}',
      NativeClient: class {
        constructor(_apiKey: string, _apiBaseUrl?: string | null) {}
      } as unknown as new (
        apiKey: string,
        apiBaseUrl?: string | null,
      ) => NativeClientLike,
    })
    expect(resolveImpl('client')).toBe('rust')
  })

  it('callNative reconstructs Api envelope as SolvaPayError with status', async () => {
    process.env.SOLVAPAY_IMPL = 'rust'
    const createCustomer = vi.fn(async () =>
      JSON.stringify({
        ok: false,
        error: {
          kind: 'Api',
          message: 'Create customer failed (400): bad',
          status: 400,
          code: null,
        },
      }),
    )
    setNativeClientForTests(fakeClient({ createCustomer }))

    await expect(
      callNative('createCustomer', JSON.stringify({ email: 'a@b.c' }), {
        apiKey: 'sk_test',
      }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(SolvaPayError)
      expect((err as SolvaPayError).message).toBe('Create customer failed (400): bad')
      expect((err as SolvaPayError).status).toBe(400)
      return true
    })
    expect(createCustomer).toHaveBeenCalledTimes(1)
    expect(createCustomer).toHaveBeenCalledWith(JSON.stringify({ email: 'a@b.c' }))
  })

  it('callNative reconstructs Paywall envelope as PaywallError with structuredContent', async () => {
    process.env.SOLVAPAY_IMPL = 'rust'
    const gate = {
      kind: 'payment_required' as const,
      product: 'prod_1',
      checkoutUrl: 'https://checkout.example/x',
      message: 'Payment required',
    }
    const getMerchant = vi.fn(async () =>
      JSON.stringify({
        ok: false,
        error: {
          kind: 'Paywall',
          message: 'Payment required',
          gate,
        },
      }),
    )
    setNativeClientForTests(fakeClient({ getMerchant }))

    await expect(
      callNative('getMerchant', '{}', { apiKey: 'sk_test' }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(PaywallError)
      expect((err as PaywallError).message).toBe('Payment required')
      expect((err as PaywallError).structuredContent).toEqual(gate)
      return true
    })
  })

  it('callNative reconstructs Transport envelope as SolvaPayError', async () => {
    process.env.SOLVAPAY_IMPL = 'rust'
    const getPlatformConfig = vi.fn(async () =>
      JSON.stringify({
        ok: false,
        error: {
          kind: 'Transport',
          message: 'connection reset',
          retryable: true,
        },
      }),
    )
    setNativeClientForTests(fakeClient({ getPlatformConfig }))

    await expect(
      callNative('getPlatformConfig', '{}', { apiKey: 'sk_test' }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(SolvaPayError)
      expect((err as SolvaPayError).message).toBe('connection reset')
      return true
    })
  })

  it('callNative returns envelope value on success', async () => {
    process.env.SOLVAPAY_IMPL = 'rust'
    const value = { customerRef: 'cus_1' }
    const createCustomer = vi.fn(async () => JSON.stringify({ ok: true, value }))
    setNativeClientForTests(fakeClient({ createCustomer }))

    const result = await callNative(
      'createCustomer',
      JSON.stringify({ email: 'a@b.c' }),
      { apiKey: 'sk_test' },
    )
    expect(result).toEqual(value)
  })

  it('callNativeSync returns envelope value on success', () => {
    process.env.SOLVAPAY_IMPL = 'rust'
    const classifyCustomerRef = vi.fn(() => JSON.stringify({ ok: true, value: 42 }))
    setNativeBindingForTests({
      verifyWebhook: () => '{}',
      classifyCustomerRef,
    })

    expect(callNativeSync('classifyCustomerRef', '{}')).toBe(42)
    expect(classifyCustomerRef).toHaveBeenCalledWith('{}')
  })

  it('callNativeSync reconstructs Api envelope as SolvaPayError', () => {
    process.env.SOLVAPAY_IMPL = 'rust'
    setNativeBindingForTests({
      verifyWebhook: () => '{}',
      classifyCustomerRef: () =>
        JSON.stringify({
          ok: false,
          error: {
            kind: 'Api',
            message: 'bad args',
            status: 400,
            code: null,
          },
        }),
    })

    expect(() => callNativeSync('classifyCustomerRef', '{}')).toThrow(SolvaPayError)
    try {
      callNativeSync('classifyCustomerRef', '{}')
    } catch (err) {
      expect(err).toBeInstanceOf(SolvaPayError)
      expect((err as SolvaPayError).message).toBe('bad args')
      expect((err as SolvaPayError).status).toBe(400)
    }
  })

  it('callNativeSync reconstructs Paywall envelope as PaywallError', () => {
    process.env.SOLVAPAY_IMPL = 'rust'
    const gate = {
      kind: 'payment_required' as const,
      product: 'prod_1',
      checkoutUrl: 'https://checkout.example/x',
      message: 'Payment required',
    }
    setNativeBindingForTests({
      verifyWebhook: () => '{}',
      buildPaywallGate: () =>
        JSON.stringify({
          ok: false,
          error: { kind: 'Paywall', message: 'Payment required', gate },
        }),
    })

    expect(() => callNativeSync('buildPaywallGate', '{}')).toThrow(PaywallError)
    try {
      callNativeSync('buildPaywallGate', '{}')
    } catch (err) {
      expect(err).toBeInstanceOf(PaywallError)
      expect((err as PaywallError).structuredContent).toEqual(gate)
    }
  })
})
