import { describe, expect, it } from 'vitest'
import { parseInitArgs, parseVerifyArgs } from './args'

describe('parseInitArgs', () => {
  it('reads every init flag', () => {
    expect(
      parseInitArgs([
        '--yes',
        '--dev',
        '--product',
        'prd_1',
        '--language',
        'python',
        '--features',
        'mcp,agents',
      ]),
    ).toEqual({
      yes: true,
      dev: true,
      productRef: 'prd_1',
      language: 'python',
      features: ['mcp', 'agents'],
    })
  })

  it('rejects an unknown language, feature or flag', () => {
    expect(() => parseInitArgs(['--language', 'ruby'])).toThrow('Unknown --language "ruby"')
    expect(() => parseInitArgs(['--features', 'mcp,billing'])).toThrow('Unknown feature "billing"')
    expect(() => parseInitArgs(['--force'])).toThrow('Unknown init flag: --force')
    expect(() => parseInitArgs(['--preview'])).toThrow('Unknown init flag: --preview')
    expect(() => parseInitArgs(['--language'])).toThrow('--language requires a value')
  })
})

describe('parseVerifyArgs', () => {
  it('reads the URL and the credentials file', () => {
    expect(parseVerifyArgs(['https://x.example/mcp', '--credentials-file', 'c.json'])).toEqual({
      serverUrl: 'https://x.example/mcp',
      credentialsFile: 'c.json',
    })
  })

  it('needs exactly one URL', () => {
    expect(() => parseVerifyArgs([])).toThrow('Usage: solvapay verify')
    expect(() => parseVerifyArgs(['https://a', 'https://b'])).toThrow('one server URL')
  })
})
