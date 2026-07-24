import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callNativeSync, resolveImpl } from '../../server/src/native'
import { SolvaPayError } from '../src/solvapay-error'
import {
  creditsToDisplayMinorUnits,
  installNativeCoreApi,
  resetNativeCoreApiForTests,
  validateBusinessDetails,
  type NativeCoreSyncMethod,
  type SolvaPayImpl,
} from '../src/native-core'

const SENTINEL_VALIDATE = { success: true as const, data: { isBusiness: false } }
const SENTINEL_CREDITS = 9999

describe('native-core.ts delegation (Step 52 Rust-only)', () => {
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
    // Restore the setupFiles install so later suites still have the API.
    resetNativeCoreApiForTests()
    installNativeCoreApi({ callNativeSync, resolveImpl })
  })

  function installFakeApi(resolve: SolvaPayImpl = 'rust'): void {
    installNativeCoreApi({
      resolveImpl: (_surface: string) => resolve,
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

  it('under SOLVAPAY_IMPL=rust, public functions return native sentinel', () => {
    process.env.SOLVAPAY_IMPL = 'rust'
    installFakeApi('rust')

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

  it('throws SolvaPayError under SOLVAPAY_IMPL=ts (no portable TS fallback)', () => {
    process.env.SOLVAPAY_IMPL = 'ts'
    const callNativeSyncFn = vi.fn()
    installNativeCoreApi({
      resolveImpl: () => 'ts',
      callNativeSync: callNativeSyncFn,
    })

    expect(() => validateBusinessDetails({ isBusiness: false })).toThrow(SolvaPayError)
    expect(callNativeSyncFn).not.toHaveBeenCalled()
  })
})
