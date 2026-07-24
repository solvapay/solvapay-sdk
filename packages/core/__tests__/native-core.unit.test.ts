import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { callNativeSync } from '../../server/src/native'
import { SolvaPayError } from '../src/solvapay-error'
import {
  creditsToDisplayMinorUnits,
  installNativeCoreApi,
  resetNativeCoreApiForTests,
  validateBusinessDetails,
  type NativeCoreSyncMethod,
} from '../src/native-core'

const SENTINEL_VALIDATE = { success: true as const, data: { isBusiness: false } }
const SENTINEL_CREDITS = 9999

describe('native-core.ts delegation', () => {
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
          case 'validateBusinessDetails':
            return SENTINEL_VALIDATE
          case 'creditsToDisplayMinorUnits':
            return SENTINEL_CREDITS
          default:
            throw new Error(`unexpected sync method: ${fn}`)
        }
      },
    })
  }

  it('public functions return native sentinel when installed', () => {
    installFakeApi()

    expect(validateBusinessDetails({ isBusiness: false })).toEqual(SENTINEL_VALIDATE)
    expect(
      creditsToDisplayMinorUnits({
        credits: 100,
        creditsPerMinorUnit: 100,
        displayExchangeRate: 1,
        displayCurrency: 'USD',
      }),
    ).toBe(SENTINEL_CREDITS)
  })

  it('throws SolvaPayError when the core API is not installed', () => {
    expect(() => validateBusinessDetails({ isBusiness: false })).toThrow(SolvaPayError)
    expect(() => validateBusinessDetails({ isBusiness: false })).toThrow(
      'core sync API not installed',
    )
  })
})
