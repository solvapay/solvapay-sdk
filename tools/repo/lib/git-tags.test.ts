import { describe, expect, it } from 'vitest'
import { parseRemoteTagNames } from './git-tags.js'

describe('parseRemoteTagNames', () => {
  it('extracts tag names and strips peeled ^{} suffixes', () => {
    const lsRemote = [
      'abc123\trefs/tags/solvapay-python-v0.1.0',
      'def456\trefs/tags/solvapay-python-v0.1.0^{}',
      'aaa111\trefs/heads/main',
      '',
    ].join('\n')
    expect(parseRemoteTagNames(lsRemote)).toEqual([
      'solvapay-python-v0.1.0',
      'solvapay-python-v0.1.0',
    ])
  })
})
