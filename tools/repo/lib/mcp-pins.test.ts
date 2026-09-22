import { describe, expect, it } from 'vitest'
import {
  fetchLatestMcpPins,
  goToolchainMinor,
  parseCratesLatest,
  parseGoLatest,
  parseGoToolchain,
  parseNpmLatest,
  parsePypiLatest,
  parseRubyGemsLatest,
  type FetchLike,
} from './mcp-pins.js'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as Response
}

function mockFetch(routes: Record<string, { status?: number; body: unknown }>): FetchLike {
  return async input => {
    const url = String(input)
    const hit = Object.entries(routes).find(([key]) => url.includes(key))
    if (hit === undefined) {
      throw new Error(`unexpected fetch ${url}`)
    }
    return jsonResponse(hit[1].status ?? 200, hit[1].body)
  }
}

describe('mcp pin registry parsers', () => {
  it('reads each registry payload shape', () => {
    expect(parseGoLatest({ Version: 'v1.7.0' })).toBe('v1.7.0')
    expect(parseGoToolchain('module x\n\ngo 1.25.0\n')).toBe('1.25.0')
    expect(parseNpmLatest({ version: '2.0.0' }, '@modelcontextprotocol/core')).toBe('2.0.0')
    expect(parsePypiLatest({ info: { version: '2.1.1' } })).toBe('2.1.1')
    expect(parseRubyGemsLatest({ version: '1.4.0' })).toBe('1.4.0')
    expect(parseCratesLatest({ crate: { max_stable_version: '3.1.4' } })).toBe('3.1.4')
  })

  it('throws when a registry omits the version', () => {
    expect(() => parseGoLatest({})).toThrow(/go-sdk Version/)
    expect(() => parseGoToolchain('module x\n')).toThrow(/missing go directive/)
    expect(() => parsePypiLatest({ info: {} })).toThrow(/pypi mcp version/)
    expect(() => parseCratesLatest({ crate: {} })).toThrow(/max_stable_version/)
  })
})

describe('goToolchainMinor', () => {
  it('strips the patch for setup-go pins', () => {
    expect(goToolchainMinor('1.25.0')).toBe('1.25')
  })
})

describe('fetchLatestMcpPins', () => {
  it('assembles pins from live registry URLs without a local fallback', async () => {
    const load = mockFetch({
      '/github.com/modelcontextprotocol/go-sdk/@latest': { body: { Version: 'v9.9.9' } },
      '/github.com/modelcontextprotocol/go-sdk/@v/v9.9.9.mod': {
        body: 'module github.com/modelcontextprotocol/go-sdk\n\ngo 1.99.0\n',
      },
      '/%40modelcontextprotocol%2Fcore/latest': { body: { version: '9.0.0' } },
      '/%40modelcontextprotocol%2Fserver/latest': { body: { version: '9.0.1' } },
      '/%40modelcontextprotocol%2Fnode/latest': { body: { version: '9.0.2' } },
      '/%40modelcontextprotocol%2Fext-apps/latest': { body: { version: '9.7.5' } },
      '/pypi.org/pypi/mcp/json': { body: { info: { version: '9.1.1' } } },
      '/rubygems.org/api/v1/gems/mcp.json': { body: { version: '9.4.0' } },
      '/crates.io/api/v1/crates/rmcp': { body: { crate: { max_stable_version: '9.1.4' } } },
    })

    await expect(fetchLatestMcpPins(load)).resolves.toEqual({
      goSdk: 'v9.9.9',
      goToolchain: '1.99.0',
      npmCore: '9.0.0',
      npmServer: '9.0.1',
      npmNode: '9.0.2',
      npmExtApps: '9.7.5',
      pythonMcp: '9.1.1',
      rubyMcp: '9.4.0',
      rustRmcp: '9.1.4',
    })
  })

  it('throws on a non-2xx registry response', async () => {
    const load = mockFetch({
      '/github.com/modelcontextprotocol/go-sdk/@latest': { status: 503, body: {} },
    })
    await expect(fetchLatestMcpPins(load)).rejects.toThrow(/503/)
  })
})
