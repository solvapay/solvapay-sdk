import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { callNativeSync } from '@solvapay/server'
import { SolvaPayError } from './solvapay-error'
import { dispatchSync, installNativeCoreApi, resetNativeCoreApiForTests } from './native-dispatch'

describe('dispatchSync', () => {
  beforeEach(() => {
    resetNativeCoreApiForTests()
  })

  afterEach(() => {
    resetNativeCoreApiForTests()
    installNativeCoreApi({ callNativeSync })
  })

  it('throws naming the method when no binding is installed', () => {
    expect(() => dispatchSync('minorUnitsPerMajor', { currency: 'USD' })).toThrow(SolvaPayError)
    expect(() => dispatchSync('minorUnitsPerMajor', { currency: 'USD' })).toThrow(
      'core sync API not installed (minorUnitsPerMajor)',
    )
  })

  it('dispatches through the installed binding', () => {
    installNativeCoreApi({
      callNativeSync: (fn, argsJson) => {
        expect(fn).toBe('minorUnitsPerMajor')
        expect(argsJson).toBe(JSON.stringify({ currency: 'USD' }))
        return 100
      },
    })
    expect(dispatchSync('minorUnitsPerMajor', { currency: 'USD' })).toBe(100)
  })
})
