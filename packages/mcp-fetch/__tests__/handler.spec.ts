import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSolvaPayMcpFetchHandler } from '../src/handler'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

vi.mock('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js', () => {
  return {
    WebStandardStreamableHTTPServerTransport: class MockTransport {
      sessionIdGenerator?: () => string
      enableJsonResponse?: boolean
      constructor(opts: { sessionIdGenerator?: () => string; enableJsonResponse?: boolean } = {}) {
        this.sessionIdGenerator = opts.sessionIdGenerator
        this.enableJsonResponse = opts.enableJsonResponse
      }
      async handleRequest(req: Request) {
        const sid = this.sessionIdGenerator?.()
        return new Response(
          JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true, sid, url: req.url } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      // Handler closes the transport per-request so the server's
      // `_transport` slot is released for the next call.
      async close() {}
    },
  }
})

const publicBaseUrl = 'https://mcp.example.com'
const apiBaseUrl = 'https://api.solvapay.com'
const productRef = 'prd_test_123'

function mockServer(): McpServer {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
  } as unknown as McpServer
}

describe('createSolvaPayMcpFetchHandler', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('responds to CORS preflight on /mcp', async () => {
    const handler = createSolvaPayMcpFetchHandler({
      server: mockServer(),
      publicBaseUrl,
      apiBaseUrl,
      productRef,
    })
    const res = await handler(
      new Request(`${publicBaseUrl}/mcp`, {
        method: 'OPTIONS',
        headers: { origin: 'cursor://mcp' },
      }),
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('cursor://mcp')
  })

  it('serves OAuth discovery via the fetch router', async () => {
    const handler = createSolvaPayMcpFetchHandler({
      server: mockServer(),
      publicBaseUrl,
      apiBaseUrl,
      productRef,
    })
    const res = await handler(
      new Request(`${publicBaseUrl}/.well-known/oauth-protected-resource`),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { resource: string }
    expect(body.resource).toBe(publicBaseUrl)
  })

  it('returns 401 + WWW-Authenticate when no bearer is present on /mcp', async () => {
    const handler = createSolvaPayMcpFetchHandler({
      server: mockServer(),
      publicBaseUrl,
      apiBaseUrl,
      productRef,
    })
    const res = await handler(
      new Request(`${publicBaseUrl}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'ping' }),
      }),
    )
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toMatch(/resource_metadata=/)
    const body = (await res.json()) as { id: number }
    expect(body.id).toBe(7)
  })

  it('forwards authenticated requests to the transport', async () => {
    const server = mockServer()
    const handler = createSolvaPayMcpFetchHandler({
      server,
      publicBaseUrl,
      apiBaseUrl,
      productRef,
    })
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
      Buffer.from(JSON.stringify({ sub: 'cust_1', exp: 9_999_999_999 })).toString('base64url') +
      '.sig'

    const res = await handler(
      new Request(`${publicBaseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${jwt}`,
          origin: 'cursor://mcp',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
      }),
    )
    expect(res.status).toBe(200)
    expect(server.connect).toHaveBeenCalledTimes(1)
    const body = (await res.json()) as { result: { ok: boolean; sid?: string } }
    expect(body.result.ok).toBe(true)
    expect(typeof body.result.sid).toBe('string')
  })

  it('skips auth when requireAuth=false and no Authorization header is present', async () => {
    const handler = createSolvaPayMcpFetchHandler({
      server: mockServer(),
      publicBaseUrl,
      apiBaseUrl,
      productRef,
      requireAuth: false,
    })
    const res = await handler(
      new Request(`${publicBaseUrl}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }),
      }),
    )
    expect(res.status).toBe(200)
  })

  it('returns 405 for unsupported methods on /mcp', async () => {
    const handler = createSolvaPayMcpFetchHandler({
      server: mockServer(),
      publicBaseUrl,
      apiBaseUrl,
      productRef,
    })
    const res = await handler(new Request(`${publicBaseUrl}/mcp`, { method: 'GET' }))
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('POST, OPTIONS')
  })

  it('returns 404 for unknown paths', async () => {
    const handler = createSolvaPayMcpFetchHandler({
      server: mockServer(),
      publicBaseUrl,
      apiBaseUrl,
      productRef,
    })
    const res = await handler(new Request(`${publicBaseUrl}/random`))
    expect(res.status).toBe(404)
  })
})
