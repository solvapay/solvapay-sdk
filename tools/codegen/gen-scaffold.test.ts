import { describe, expect, it } from 'vitest'
import { parseArgs } from './gen-scaffold.js'

describe('gen-scaffold CLI', () => {
  it('parses operation args', () => {
    const opts = parseArgs(['operation', 'fooBar', '--method', 'POST', '--path', '/v1/sdk/foo'])
    expect(opts.kind).toBe('operation')
    expect(opts.id).toBe('fooBar')
    expect(opts.method).toBe('POST')
    expect(opts.path).toBe('/v1/sdk/foo')
    expect(opts.withBindings).toBe(false)
  })

  it('returns usage on missing args', () => {
    expect(() => parseArgs([])).toThrow(/Usage/)
  })
})
