import { describe, expect, it } from 'vitest'
import {
  applyNativeCors,
  authChallenge,
  corsPreflight,
  isNativeClientOrigin,
  resolveBearer,
} from '../../src/fetch/cors'

describe('isNativeClientOrigin', () => {
  it('matches native MCP client schemes', () => {
    expect(isNativeClientOrigin('cursor://mcp/solvapay')).toBe(true)
    expect(isNativeClientOrigin('vscode://ms.copilot/callback')).toBe(true)
    expect(isNativeClientOrigin('vscode-webview://abcd1234')).toBe(true)
    expect(isNativeClientOrigin('claude://auth/return')).toBe(true)
  })

  it('rejects everything else', () => {
    expect(isNativeClientOrigin(null)).toBe(false)
    expect(isNativeClientOrigin('')).toBe(false)
    expect(isNativeClientOrigin('https://example.com')).toBe(false)
    expect(isNativeClientOrigin('http://localhost:3000')).toBe(false)
    expect(isNativeClientOrigin('file:///etc/passwd')).toBe(false)
  })
})

describe('applyNativeCors', () => {
  it('mirrors native-scheme origin back in Access-Control-Allow-Origin', () => {
    const reqHeaders = new Headers({ origin: 'cursor://mcp/solvapay' })
    const resHeaders = new Headers()
    applyNativeCors(reqHeaders, resHeaders)
    expect(resHeaders.get('access-control-allow-origin')).toBe('cursor://mcp/solvapay')
    expect(resHeaders.get('vary')).toBe('Origin')
  })

  it('does NOT mirror https origins (keeps bare response — host decides policy)', () => {
    const reqHeaders = new Headers({ origin: 'https://example.com' })
    const resHeaders = new Headers()
    applyNativeCors(reqHeaders, resHeaders)
    expect(resHeaders.get('access-control-allow-origin')).toBeNull()
  })

  it('is a no-op when there is no Origin header', () => {
    const resHeaders = new Headers()
    applyNativeCors(new Headers(), resHeaders)
    expect(resHeaders.get('access-control-allow-origin')).toBeNull()
  })
})

describe('corsPreflight', () => {
  it('returns 204 with mirrored allow-origin for native schemes', async () => {
    const req = new Request('https://mcp.example.com/mcp', {
      method: 'OPTIONS',
      headers: {
        origin: 'cursor://mcp',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization, content-type, mcp-session-id',
      },
    })
    const res = corsPreflight(req)
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('cursor://mcp')
    expect(res.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS')
    expect(res.headers.get('access-control-allow-headers')).toBe(
      'authorization, content-type, mcp-session-id',
    )
    expect(res.headers.get('access-control-max-age')).toBe('600')
  })

  it('falls back to POST/default headers when request omits them', async () => {
    const req = new Request('https://mcp.example.com/mcp', {
      method: 'OPTIONS',
      headers: { origin: 'vscode://foo' },
    })
    const res = corsPreflight(req)
    expect(res.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS')
    expect(res.headers.get('access-control-allow-headers')).toBe('authorization, content-type')
  })
})

describe('authChallenge', () => {
  it('returns 401 JSON-RPC error with WWW-Authenticate resource_metadata', async () => {
    const req = new Request('https://mcp.example.com/mcp', {
      method: 'POST',
      headers: { origin: 'cursor://mcp' },
    })
    const res = authChallenge(req, { publicBaseUrl: 'https://mcp.example.com/' })
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toBe(
      'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"',
    )
    expect(res.headers.get('access-control-allow-origin')).toBe('cursor://mcp')
    expect(res.headers.get('access-control-expose-headers')).toBe('WWW-Authenticate')

    const body = (await res.json()) as { jsonrpc: string; id: null; error: { code: number } }
    expect(body.jsonrpc).toBe('2.0')
    expect(body.error.code).toBe(-32001)
  })

  it('honors custom protectedResourcePath + jsonRpcId', async () => {
    const req = new Request('https://mcp.example.com/mcp')
    const res = authChallenge(req, {
      publicBaseUrl: 'https://mcp.example.com',
      protectedResourcePath: '/custom/.well-known/oauth-protected-resource',
      jsonRpcId: 42,
    })
    expect(res.headers.get('www-authenticate')).toBe(
      'Bearer resource_metadata="https://mcp.example.com/custom/.well-known/oauth-protected-resource"',
    )
    const body = (await res.json()) as { id: number }
    expect(body.id).toBe(42)
  })
})

describe('resolveBearer', () => {
  it('extracts the bearer token', () => {
    const req = new Request('https://mcp.example.com/mcp', {
      headers: { authorization: 'Bearer abc.def.ghi' },
    })
    expect(resolveBearer(req)).toBe('abc.def.ghi')
  })

  it('is case-insensitive on the scheme', () => {
    const req = new Request('https://mcp.example.com/mcp', {
      headers: { authorization: 'bearer  xyz' },
    })
    expect(resolveBearer(req)).toBe('xyz')
  })

  it('returns null when header is missing or not a Bearer', () => {
    expect(resolveBearer(new Request('https://x/'))).toBeNull()
    expect(
      resolveBearer(
        new Request('https://x/', { headers: { authorization: 'Basic dXNlcjpwYXNz' } }),
      ),
    ).toBeNull()
  })
})
