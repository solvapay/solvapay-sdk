import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { callNativeSync } from '@solvapay/server'
import { SolvaPayError } from './solvapay-error'
import {
  dispatchSync,
  installCoreSyncFallbacks,
  installNativeCoreApi,
  resetNativeCoreApiForTests,
} from './native-dispatch'

describe('dispatchSync fallback registry', () => {
  beforeEach(() => {
    resetNativeCoreApiForTests()
    installCoreSyncFallbacks({})
  })

  afterEach(() => {
    resetNativeCoreApiForTests()
    installCoreSyncFallbacks({})
    installNativeCoreApi({ callNativeSync })
  })

  it('should use the registered fallback when no binding is installed', () => {
    installCoreSyncFallbacks({
      minorUnitsPerMajor: () => 42,
    })

    expect(dispatchSync('minorUnitsPerMajor', { currency: 'USD' })).toBe(42)
  })

  it('should prefer the installed binding over a registered fallback', () => {
    installCoreSyncFallbacks({
      minorUnitsPerMajor: () => 42,
    })
    installNativeCoreApi({
      callNativeSync: () => 7,
    })

    expect(dispatchSync('minorUnitsPerMajor', { currency: 'USD' })).toBe(7)
  })

  it('should throw naming the method when no binding and no fallback exist', () => {
    expect(() => dispatchSync('minorUnitsPerMajor', { currency: 'USD' })).toThrow(SolvaPayError)
    expect(() => dispatchSync('minorUnitsPerMajor', { currency: 'USD' })).toThrow(
      'core sync API not installed (no portable fallback for minorUnitsPerMajor)',
    )
  })

  it('should serialize args identically on both paths', () => {
    const args = { currency: 'USD' }
    let bindingArgsJson: string | undefined
    let fallbackArgs: unknown

    installNativeCoreApi({
      callNativeSync: (_fn, argsJson) => {
        bindingArgsJson = argsJson
        return 100
      },
    })
    dispatchSync('minorUnitsPerMajor', args)

    resetNativeCoreApiForTests()
    installCoreSyncFallbacks({
      minorUnitsPerMajor: received => {
        fallbackArgs = received
        return 100
      },
    })
    dispatchSync('minorUnitsPerMajor', args)

    expect(JSON.stringify(fallbackArgs)).toBe(bindingArgsJson)
    expect(bindingArgsJson).toBe(JSON.stringify(args))
  })
})
