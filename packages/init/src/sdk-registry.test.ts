import { describe, expect, it } from 'vitest'
import {
  compareGoVersions,
  comparePep440,
  isGoPreview,
  isPythonPreview,
  pickSdkVersion,
} from './sdk-registry'

describe('comparePep440', () => {
  it('orders dev, pre, final and post releases', () => {
    const sorted = [
      '1.0.post1',
      '1.0',
      '1.0rc1',
      '1.0a1',
      '1.0.dev2',
      '1.0b2',
      '1.0.dev10',
      '0.9',
      '1.0a1.dev1',
    ].sort(comparePep440)
    expect(sorted).toEqual([
      '0.9',
      '1.0.dev2',
      '1.0.dev10',
      '1.0a1.dev1',
      '1.0a1',
      '1.0b2',
      '1.0rc1',
      '1.0',
      '1.0.post1',
    ])
  })

  it('treats 0.1 and 0.1.0 as equal', () => {
    expect(comparePep440('0.1', '0.1.0')).toBe(0)
  })

  it('rejects a version it cannot parse', () => {
    expect(() => comparePep440('latest', '0.1.0')).toThrow('Not a PEP 440 version')
  })

  it('knows a preview', () => {
    expect(isPythonPreview('0.1.0.dev12')).toBe(true)
    expect(isPythonPreview('0.1.0rc1')).toBe(true)
    expect(isPythonPreview('0.1.0')).toBe(false)
    expect(isPythonPreview('0.1.0.post1')).toBe(false)
  })
})

describe('compareGoVersions', () => {
  it('orders semver pre-releases numerically', () => {
    const sorted = ['v0.1.0', 'v0.1.0-dev.10', 'v0.1.0-dev.7', 'v0.0.9', 'v0.1.0-dev.7.1'].sort(
      compareGoVersions,
    )
    expect(sorted).toEqual(['v0.0.9', 'v0.1.0-dev.7', 'v0.1.0-dev.7.1', 'v0.1.0-dev.10', 'v0.1.0'])
  })

  it('knows a preview', () => {
    expect(isGoPreview('v0.1.0-dev.7')).toBe(true)
    expect(isGoPreview('v0.1.0')).toBe(false)
  })

  it('rejects a version without the v prefix', () => {
    expect(() => compareGoVersions('0.1.0', 'v0.1.0')).toThrow('Not a Go module version')
  })
})

describe('pickSdkVersion', () => {
  it('pins the newest stable release', () => {
    expect(pickSdkVersion('python', ['0.1.0', '0.2.0.dev1', '0.1.2'], { preview: false })).toBe(
      '0.1.2',
    )
  })

  it('pins the newest version of any kind with --preview', () => {
    expect(pickSdkVersion('python', ['0.1.0', '0.2.0.dev1'], { preview: true })).toBe('0.2.0.dev1')
    expect(pickSdkVersion('go', ['v0.1.0-dev.7', 'v0.1.0-dev.10'], { preview: true })).toBe(
      'v0.1.0-dev.10',
    )
  })

  it('fails and names --preview when only previews exist', () => {
    expect(() => pickSdkVersion('go', ['v0.1.0-dev.7'], { preview: false })).toThrow(
      'github.com/solvapay/solvapay-sdk/go has no stable release on the Go module proxy yet (newest preview: v0.1.0-dev.7). Pass --preview to install the preview.',
    )
  })

  it('fails when the registry lists nothing', () => {
    expect(() => pickSdkVersion('python', [], { preview: true })).toThrow('PyPI lists no versions')
  })
})
