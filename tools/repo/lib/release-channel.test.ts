import { describe, expect, it } from 'vitest'
import {
  assertAllRehearsalTags,
  assertHostMatchesChannel,
  assertTagsAvailable,
  ecosystemVersion,
  goModuleTag,
  parseReleaseTag,
  resolveChannelFromRef,
  tagsAlreadyOnRemote,
  trainTagName,
  trainTags,
} from './release-channel.js'

describe('resolveChannelFromRef', () => {
  it('treats rehearsal/ refs as rehearsal and everything else as production', () => {
    expect(resolveChannelFromRef('refs/tags/rehearsal/solvapay-rust-v0.2.0')).toBe('rehearsal')
    expect(resolveChannelFromRef('rehearsal/solvapay-python-v0.2.0')).toBe('rehearsal')
    expect(resolveChannelFromRef('refs/tags/solvapay-rust-v0.2.0')).toBe('production')
    expect(resolveChannelFromRef('refs/heads/main')).toBe('production')
  })
})

describe('train tags', () => {
  it('names production and rehearsal tags from the sentinel version', () => {
    expect(trainTags('0.2.0', 'production')).toEqual({
      rust: 'solvapay-rust-v0.2.0',
      python: 'solvapay-python-v0.2.0',
      ruby: 'solvapay-ruby-v0.2.0',
      go: 'solvapay-go-v0.2.0',
    })
    expect(trainTagName('ruby', '0.2.0', 'rehearsal')).toBe('rehearsal/solvapay-ruby-v0.2.0')
  })

  it('rejects a non-semver sentinel version', () => {
    expect(() => trainTags('0.2.0-rehearsal.7', 'production')).toThrow(/invalid lockstep semver/)
  })

  it('parses language, channel, and version from a tag ref', () => {
    expect(parseReleaseTag('refs/tags/rehearsal/solvapay-go-v1.4.0')).toEqual({
      channel: 'rehearsal',
      language: 'go',
      version: '1.4.0',
    })
    expect(parseReleaseTag('solvapay-python-v0.1.0')).toEqual({
      channel: 'production',
      language: 'python',
      version: '0.1.0',
    })
  })
})

describe('ecosystemVersion', () => {
  it('keeps production versions unsuffixed and maps rehearsal suffixes per ecosystem', () => {
    expect(ecosystemVersion('0.2.0', 'production', 'python', 7)).toBe('0.2.0')
    expect(ecosystemVersion('0.2.0', 'rehearsal', 'npm', 7)).toBe('0.2.0-rehearsal.7')
    expect(ecosystemVersion('0.2.0', 'rehearsal', 'cargo', 7)).toBe('0.2.0-rehearsal.7')
    expect(ecosystemVersion('0.2.0', 'rehearsal', 'go', 7)).toBe('0.2.0-rehearsal.7')
    expect(ecosystemVersion('0.2.0', 'rehearsal', 'python', 7)).toBe('0.2.0.dev7')
    expect(ecosystemVersion('0.2.0', 'rehearsal', 'ruby', 7)).toBe('0.2.0.pre.7')
  })

  it('throws when a rehearsal run number is missing', () => {
    expect(() => ecosystemVersion('0.2.0', 'rehearsal', 'python', 0)).toThrow(/run number/)
  })
})

describe('goModuleTag', () => {
  it('prefixes the nested module path and keeps rehearsal as a prerelease', () => {
    expect(goModuleTag('0.2.0', 'production', 7)).toBe('sdks/go/v0.2.0')
    expect(goModuleTag('0.2.0', 'rehearsal', 7)).toBe('sdks/go/v0.2.0-rehearsal.7')
  })
})

describe('host vs channel', () => {
  it('throws when a production host is used on the rehearsal channel', () => {
    expect(() => assertHostMatchesChannel('rehearsal', 'cargo', 'https://crates.io/')).toThrow(
      /does not match rehearsal cargo/,
    )
    expect(() =>
      assertHostMatchesChannel('production', 'python', 'https://test.pypi.org/legacy/'),
    ).toThrow(/does not match production python/)
  })

  it('accepts the matching host', () => {
    expect(() =>
      assertHostMatchesChannel('rehearsal', 'python', 'https://test.pypi.org/legacy/'),
    ).not.toThrow()
    expect(() =>
      assertHostMatchesChannel('production', 'ruby', 'https://rubygems.org'),
    ).not.toThrow()
  })
})

describe('tag availability', () => {
  it('lists tags that already exist and throws from the assertion helper', () => {
    const tags = ['solvapay-rust-v0.2.0', 'solvapay-go-v0.2.0']
    expect(tagsAlreadyOnRemote(tags, ['solvapay-go-v0.2.0'])).toEqual(['solvapay-go-v0.2.0'])
    expect(() => assertTagsAvailable(tags, ['solvapay-rust-v0.2.0'])).toThrow(
      /tags already exist on remote/,
    )
    expect(() => assertTagsAvailable(tags, [])).not.toThrow()
  })
})

describe('assertAllRehearsalTags', () => {
  it('accepts only tags under rehearsal/', () => {
    expect(() =>
      assertAllRehearsalTags(['rehearsal/solvapay-rust-v0.1.0', 'rehearsal/solvapay-go-v0.1.0']),
    ).not.toThrow()
  })

  it('throws when any tag is outside rehearsal/', () => {
    expect(() =>
      assertAllRehearsalTags(['rehearsal/solvapay-rust-v0.1.0', 'solvapay-go-v0.1.0']),
    ).toThrow(/non-rehearsal tags: solvapay-go-v0.1.0/)
    expect(() => assertAllRehearsalTags(['rehearsal'])).toThrow(/non-rehearsal tags: rehearsal/)
  })
})
