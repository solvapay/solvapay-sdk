import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SolvaPayError } from '@solvapay/core'
import { callNativeSync, resolveImpl, type NativeSyncMethod, type SolvaPayImpl } from '../src/native'
import {
  buildPaywallGate,
  classifyCustomerRef,
  installNativeDecisionApi,
  resetNativeDecisionApiForTests,
  retryNextDelayMs,
} from '../src/native-decisions'
import type { PaywallState } from '../src/paywall-state'

const SENTINEL_CLASSIFY = 'SENTINEL_classifyCustomerRef'
const SENTINEL_GATE = {
  kind: 'payment_required',
  product: 'SENTINEL',
  message: 'sentinel',
  checkoutUrl: '',
}
const SENTINEL_RETRY = 4242

const RETRY_ARGS = {
  maxRetries: 2,
  initialDelay: 500,
  backoffStrategy: 'fixed',
  attempt: 0,
} as const
const GATE_LIMITS = { remaining: 0, withinLimits: false, plan: '' }

// Type-level coverage: every `PaywallState` discriminant (including the
// currently-unreachable `reactivation_required`) must survive the move to
// `types/paywall.ts` and stay exported through `paywall-state`.
const _paywallStates: PaywallState[] = [
  { kind: 'activation_required' },
  { kind: 'topup_required' },
  { kind: 'upgrade_required' },
  { kind: 'reactivation_required' },
]

describe('native-decisions.ts Rust-only dispatch (Step 53)', () => {
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

  function installFakeApi(resolve: SolvaPayImpl, onCall?: () => void): void {
    installNativeDecisionApi({
      resolveImpl: (_surface: string) => resolve,
      callNativeSync: (fn: NativeSyncMethod, _argsJson: string) => {
        onCall?.()
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

  it('installed Rust sentinel wins for helpers, paywall, and retry', () => {
    installFakeApi('rust')

    expect(classifyCustomerRef('cus_abc')).toBe(SENTINEL_CLASSIFY)
    expect(buildPaywallGate('prod_1', GATE_LIMITS)).toEqual(SENTINEL_GATE)
    expect(retryNextDelayMs({ ...RETRY_ARGS })).toBe(SENTINEL_RETRY)
  })

  it('SOLVAPAY_IMPL=ts throws and never dispatches (no server TS fallback)', () => {
    process.env.SOLVAPAY_IMPL = 'ts'
    let called = false
    installFakeApi('ts', () => {
      called = true
    })

    expect(() => classifyCustomerRef('cus_abc')).toThrow(SolvaPayError)
    expect(() => buildPaywallGate('prod_1', GATE_LIMITS)).toThrow('server sync API not installed')
    expect(() => retryNextDelayMs({ ...RETRY_ARGS })).toThrow(SolvaPayError)
    expect(called).toBe(false)
  })

  it('uninstalled decision API throws — no core facade, no local fallback', () => {
    // no installNativeDecisionApi in this test
    expect(() => classifyCustomerRef('cus_abc')).toThrow('server sync API not installed')
    expect(() => buildPaywallGate('prod_1', GATE_LIMITS)).toThrow(SolvaPayError)
    expect(() => retryNextDelayMs({ ...RETRY_ARGS })).toThrow('server sync API not installed')
  })

  it('with the real resolveImpl, SOLVAPAY_IMPL=ts fails fast before any dispatch', () => {
    process.env.SOLVAPAY_IMPL = 'ts'
    installNativeDecisionApi({ callNativeSync, resolveImpl })

    expect(() => classifyCustomerRef('cus_abc')).toThrow('server sync API not installed')
    expect(() => retryNextDelayMs({ ...RETRY_ARGS })).toThrow('server sync API not installed')
  })
})
