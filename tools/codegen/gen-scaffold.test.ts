import { describe, expect, it } from 'vitest'
import { parseArgs } from './gen-scaffold.js'

describe('gen-scaffold CLI', () => {
  it('parses operation args', () => {
    const opts = parseArgs(['operation', 'fooBar', '--method', 'POST', '--path', '/v1/sdk/foo'])
    expect(opts.kind).toBe('operation')
    expect(opts.id).toBe('fooBar')
    expect(opts.method).toBe('POST')
    expect(opts.path).toBe('/v1/sdk/foo')
  })

  it('rejects the retired --no-bindings flag', () => {
    expect(() =>
      parseArgs([
        'operation',
        'fooBar',
        '--method',
        'POST',
        '--path',
        '/v1/sdk/foo',
        '--no-bindings',
      ]),
    ).toThrow(/Unknown argument/)
  })

  it('returns usage on missing args', () => {
    expect(() => parseArgs([])).toThrow(/Usage/)
  })
})
