import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callNativeSync, resolveImpl } from '../../server/src/native'
import { SolvaPayError } from '../src/solvapay-error'
import {
  installNativeCoreApi,
  resetNativeCoreApiForTests,
  type NativeCoreSyncMethod,
  type SolvaPayImpl,
} from '../src/native-core'
import {
  buildCreateCustomerParams,
  classifyCustomerRef,
  decidePaywallOutcome,
  mapRouteError,
} from '../src/native-helpers'

const SENTINEL_CLASSIFY = 'SENTINEL_backend' as const
const SENTINEL_PARAMS = {
  email: 'sentinel@example.com',
  metadata: { source: 'sentinel' },
}
const SENTINEL_ROUTE = { error: 'sentinel', status: 418 }
const SENTINEL_OUTCOME = { outcome: 'allow' as const }

describe('native-helpers.ts delegation (Step 52 Rust-only)', () => {
  const originalImpl = process.env.SOLVAPAY_IMPL

  beforeEach(() => {
    delete process.env.SOLVAPAY_IMPL
    resetNativeCoreApiForTests()
  })

  afterEach(() => {
    if (originalImpl === undefined) {
      delete process.env.SOLVAPAY_IMPL
    } else {
      process.env.SOLVAPAY_IMPL = originalImpl
    }
    resetNativeCoreApiForTests()
    installNativeCoreApi({ callNativeSync, resolveImpl })
  })

  function installFakeApi(resolve: SolvaPayImpl = 'rust'): void {
    installNativeCoreApi({
      resolveImpl: (_surface: string) => resolve,
      callNativeSync: (fn: NativeCoreSyncMethod, _argsJson: string) => {
        switch (fn) {
          case 'classifyCustomerRef':
            return SENTINEL_CLASSIFY
          case 'buildCreateCustomerParams':
            return SENTINEL_PARAMS
          case 'mapRouteError':
            return SENTINEL_ROUTE
          case 'decidePaywallOutcome':
            return SENTINEL_OUTCOME
          default:
            throw new Error(`unexpected sync method: ${fn}`)
        }
      },
    })
  }

  it('delegates helpers via callNativeSync when installed', () => {
    process.env.SOLVAPAY_IMPL = 'rust'
    installFakeApi('rust')

    expect(classifyCustomerRef('cus_abc')).toBe(SENTINEL_CLASSIFY)
    expect(buildCreateCustomerParams('user-1', undefined, 'a@b.c', undefined, 1)).toEqual(
      SENTINEL_PARAMS,
    )
    expect(
      mapRouteError({
        kind: 'error',
        message: 'x',
        operationName: 'op',
      }),
    ).toEqual(SENTINEL_ROUTE)
    expect(
      decidePaywallOutcome({
        withinLimits: true,
        product: 'p',
        limits: null,
        buildGate: () => ({ kind: 'unused' }),
      }),
    ).toEqual(SENTINEL_OUTCOME)
  })

  it('throws SolvaPayError when the core API is not installed', () => {
    expect(() => classifyCustomerRef('cus_abc')).toThrow(SolvaPayError)
    expect(() => classifyCustomerRef('cus_abc')).toThrow('core sync API not installed')
  })

  it('throws under SOLVAPAY_IMPL=ts (no portable TS fallback)', () => {
    process.env.SOLVAPAY_IMPL = 'ts'
    const callNativeSyncFn = vi.fn()
    installNativeCoreApi({
      resolveImpl: () => 'ts',
      callNativeSync: callNativeSyncFn,
    })

    expect(() => classifyCustomerRef('cus_abc')).toThrow(SolvaPayError)
    expect(callNativeSyncFn).not.toHaveBeenCalled()
  })
})
