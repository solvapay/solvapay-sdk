import { describe, expect, it } from 'vitest'
import { SolvaPayError } from '@solvapay/core'
import {
  assertLoadedNativeMatchesPackage,
  readServerPackageVersion,
  type NativeStampBinding,
} from './version-skew'

function stamp(version: string): NativeStampBinding {
  return {
    nativeBuildInfo: () => JSON.stringify({ version, coreSha: 'abc' }),
  }
}

describe('native version skew guard', () => {
  it('does nothing when the optional native binding is absent', () => {
    expect(() => assertLoadedNativeMatchesPackage(null)).not.toThrow()
  })

  it('accepts a loaded binding whose stamp matches the package version', () => {
    const version = readServerPackageVersion()
    expect(version.length).toBeGreaterThan(0)
    expect(() => assertLoadedNativeMatchesPackage(stamp(version))).not.toThrow()
  })

  it('throws version_skew when the loaded native stamp disagrees', () => {
    let thrown: unknown
    try {
      assertLoadedNativeMatchesPackage(stamp('9.9.9'))
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(SolvaPayError)
    if (!(thrown instanceof SolvaPayError)) {
      throw new Error('expected SolvaPayError')
    }
    expect(thrown.code).toBe('version_skew')
    expect(thrown.message).toContain('package=')
    expect(thrown.message).toContain('native="9.9.9"')
  })

  it('throws version_skew when a loaded binding has no nativeBuildInfo stamp', () => {
    let thrown: unknown
    try {
      assertLoadedNativeMatchesPackage({})
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(SolvaPayError)
    if (!(thrown instanceof SolvaPayError)) {
      throw new Error('expected SolvaPayError')
    }
    expect(thrown.code).toBe('version_skew')
    expect(thrown.message).toContain('nativeBuildInfo')
  })
})
