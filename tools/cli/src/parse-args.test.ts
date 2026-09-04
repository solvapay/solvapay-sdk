import { describe, expect, it } from 'vitest'
import { parseInitArgs } from './parse-args'

describe('parseInitArgs', () => {
  it('parses --language and -l', () => {
    expect(parseInitArgs(['--language', 'python'])).toMatchObject({ language: 'python' })
    expect(parseInitArgs(['-l', 'go'])).toMatchObject({ language: 'go' })
  })

  it('rejects an unknown language', () => {
    expect(() => parseInitArgs(['--language', 'cobol'])).toThrow(/Unknown language/)
  })
})
