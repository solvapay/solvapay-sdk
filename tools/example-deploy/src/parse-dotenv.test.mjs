import { describe, expect, it } from 'vitest'
import { parseDotEnv } from './parse-dotenv.mjs'

describe('parseDotEnv', () => {
  it('skips comments and blank lines', () => {
    expect(
      parseDotEnv(`
# heading
FOO=bar

BAZ=qux
`),
    ).toEqual({ FOO: 'bar', BAZ: 'qux' })
  })

  it('strips a single layer of matching quotes', () => {
    expect(parseDotEnv(`FOO="bar baz"\nBAR='qux'`)).toEqual({ FOO: 'bar baz', BAR: 'qux' })
  })

  it('preserves hashes inside quoted values', () => {
    expect(parseDotEnv(`FOO="bar # not a comment"`)).toEqual({ FOO: 'bar # not a comment' })
  })

  it('strips unquoted inline comments the way wrangler does', () => {
    expect(parseDotEnv(`FOO=bar # note`)).toEqual({ FOO: 'bar' })
  })
})
