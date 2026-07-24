import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { callNativeSync } from '../../server/src/native'
import { SolvaPayError } from '../src/solvapay-error'
import {
  installNativeCoreApi,
  resetNativeCoreApiForTests,
  type NativeCoreSyncMethod,
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

describe('native-helpers.ts delegation', () => {
  beforeEach(() => {
    resetNativeCoreApiForTests()
  })

  afterEach(() => {
    resetNativeCoreApiForTests()
    installNativeCoreApi({ callNativeSync })
  })

  function installFakeApi(): void {
    installNativeCoreApi({
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
    installFakeApi()

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
})
