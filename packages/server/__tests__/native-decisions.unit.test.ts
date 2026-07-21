import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callNativeSync, resolveImpl, type NativeSyncMethod, type SolvaPayImpl } from '../src/native'
import {
  buildPaywallGate,
  classifyCustomerRef,
  installNativeDecisionApi,
  resetNativeDecisionApiForTests,
  retryNextDelayMs,
} from '../src/native-decisions'

const SENTINEL_CLASSIFY = 'SENTINEL_classifyCustomerRef'
const SENTINEL_GATE = { kind: 'payment_required', product: 'SENTINEL', message: 'sentinel', checkoutUrl: '' }
const SENTINEL_RETRY = 4242

describe('native-decisions.ts delegation', () => {
  const originalImpl = process.env.SOLVAPAY_IMPL

  beforeEach(() => {
    delete process.env.SOLVAPAY_IMPL
    resetNativeDecisionApiForTests()
  })

  afterEach(() => {
    if (originalImpl === undefined) {
      delete process.env.SOLVAPAY_IMPL
    } else {
      process.env.SOLVAPAY_IMPL = originalImpl
    }
    // Restore the setupFiles install so later suites still have the API.
    resetNativeDecisionApiForTests()
    installNativeDecisionApi({ callNativeSync, resolveImpl })
  })

  function installFakeApi(resolve: SolvaPayImpl = 'rust'): void {
    installNativeDecisionApi({
      resolveImpl: (_surface: string) => resolve,
      callNativeSync: (fn: NativeSyncMethod, _argsJson: string) => {
        switch (fn) {
          case 'classifyCustomerRef':
            return SENTINEL_CLASSIFY
          case 'buildPaywallGate':
            return SENTINEL_GATE
          case 'retryNextDelayMs':
            return SENTINEL_RETRY
          default:
            throw new Error(`unexpected sync method: ${fn}`)
        }
      },
    })
  }

  it('under SOLVAPAY_IMPL=rust, public functions return native sentinel', () => {
    process.env.SOLVAPAY_IMPL = 'rust'
    installFakeApi('rust')

    expect(classifyCustomerRef('cus_abc')).toBe(SENTINEL_CLASSIFY)
    expect(buildPaywallGate('prod_1', { remaining: 0, withinLimits: false, plan: '' })).toEqual(
      SENTINEL_GATE,
    )
    expect(
      retryNextDelayMs({
        maxRetries: 2,
        initialDelay: 500,
        backoffStrategy: 'fixed',
        attempt: 0,
      }),
    ).toBe(SENTINEL_RETRY)
  })

  it('under SOLVAPAY_IMPL=ts, TS body is used (not sentinel)', () => {
    process.env.SOLVAPAY_IMPL = 'ts'
    const callNativeSync = vi.fn()
    installNativeDecisionApi({
      resolveImpl: () => 'ts',
      callNativeSync,
    })

    expect(classifyCustomerRef('cus_abc')).toBe('backend')
    expect(classifyCustomerRef('anonymous')).toBe('anonymous')
    expect(classifyCustomerRef('user-1')).toBe('needsEnsure')

    const gate = buildPaywallGate('prod_1', {
      remaining: 0,
      withinLimits: false,
      plan: '',
      checkoutUrl: 'https://checkout.example',
    })
    expect(gate.product).toBe('prod_1')
    expect(gate.kind).toBe('payment_required')
    expect(gate).not.toEqual(SENTINEL_GATE)

    expect(
      retryNextDelayMs({
        maxRetries: 2,
        initialDelay: 500,
        backoffStrategy: 'fixed',
        attempt: 0,
      }),
    ).toBe(500)
    expect(
      retryNextDelayMs({
        maxRetries: 2,
        initialDelay: 500,
        backoffStrategy: 'fixed',
        attempt: 2,
      }),
    ).toBeNull()

    expect(callNativeSync).not.toHaveBeenCalled()
  })

  it('without install, always uses TS fallback even if SOLVAPAY_IMPL=rust', () => {
    process.env.SOLVAPAY_IMPL = 'rust'
    // no installNativeDecisionApi
    expect(classifyCustomerRef('cus_abc')).toBe('backend')
  })
})
