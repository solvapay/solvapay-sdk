import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SolvaPayError } from '@solvapay/core'
import { callNativeSync, type NativeSyncMethod } from '../src/native'
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

describe('native-decisions.ts dispatch', () => {
  beforeEach(() => {
    resetNativeDecisionApiForTests()
  })

  afterEach(() => {
    resetNativeDecisionApiForTests()
    installNativeDecisionApi({ callNativeSync })
  })

  function installFakeApi(onCall?: () => void): void {
    installNativeDecisionApi({
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

  it('installed binding sentinel wins for helpers, paywall, and retry', () => {
    installFakeApi()

    expect(classifyCustomerRef('cus_abc')).toBe(SENTINEL_CLASSIFY)
    expect(buildPaywallGate('prod_1', GATE_LIMITS)).toEqual(SENTINEL_GATE)
    expect(retryNextDelayMs({ ...RETRY_ARGS })).toBe(SENTINEL_RETRY)
  })

  it('uninstalled decision API throws — no core facade, no local fallback', () => {
    expect(() => classifyCustomerRef('cus_abc')).toThrow('server sync API not installed')
    expect(() => buildPaywallGate('prod_1', GATE_LIMITS)).toThrow(SolvaPayError)
    expect(() => retryNextDelayMs({ ...RETRY_ARGS })).toThrow('server sync API not installed')
  })
})
