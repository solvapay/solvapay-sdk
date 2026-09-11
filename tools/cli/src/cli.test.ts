import { afterEach, describe, expect, it, vi } from 'vitest'
import { PACKAGE_VERSION, printVersionBanner } from './version-banner'

describe('printVersionBanner', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('writes a single line containing the package version', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    printVersionBanner()
    expect(spy).toHaveBeenCalledOnce()
    const written = spy.mock.calls[0][0] as string
    expect(written).toContain(`solvapay v${PACKAGE_VERSION}`)
    expect(written.endsWith('\n')).toBe(true)
  })

  it('exposes a semver-shaped PACKAGE_VERSION constant', () => {
    expect(PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+/)
  })
})
