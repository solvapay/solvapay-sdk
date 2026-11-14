import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServerFactory } from '@modelcontextprotocol/server'
import { createSolvaPayMcpFetchHandler } from '../../src/fetch/handler'
import { createMcpOAuthBridge } from '../../src/express/oauth-bridge'

const publicBaseUrl = 'https://mcp.example.com'
const apiBaseUrl = 'https://api.solvapay.test'
const productRef = 'prd_test_123'
const seenAuth: unknown[] = []

vi.mock('@modelcontextprotocol/server', async importOriginal => {
  const actual = await importOriginal<typeof import('@modelcontextprotocol/server')>()
  return {
    ...actual,
    createMcpHandler: vi.fn(() => ({
      fetch: vi.fn(async (_req: Request, options?: { authInfo?: unknown }) => {
        seenAuth.push(options?.authInfo)
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }),
      close: vi.fn(),
      notify: {},
      bus: {},
    })),
  }
})

/** A JWT anyone can make: its payload names a customer, its signature is junk. */
function forged(sub: string): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub, exp: 9_999_999_999 })}.forged`
}

function userinfo(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function mcpRequest(token: string): Request {
  return new Request(`${publicBaseUrl}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list' }),
  })
}

function fetchHandler() {
  const factory = vi
    .fn()
    .mockReturnValue({ connect: vi.fn(), close: vi.fn() }) as unknown as McpServerFactory
  return createSolvaPayMcpFetchHandler({ factory, publicBaseUrl, apiBaseUrl, productRef })
}

describe('fetch handler: bearer tokens are verified with SolvaPay', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    seenAuth.length = 0
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('challenges a forged token SolvaPay refuses, without serving it', async () => {
    fetchMock.mockResolvedValue(userinfo(401, { message: 'Unauthorized' }))
    const res = await fetchHandler()(mcpRequest(forged('cus_VICTIM')))
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toContain('Bearer')
    expect(seenAuth).toHaveLength(0)
    expect(fetchMock).toHaveBeenCalledWith(
      `${apiBaseUrl}/v1/customer/auth/userinfo`,
      expect.anything(),
    )
  })

  it('serves a valid token as the customer SolvaPay names, not the one the token claims', async () => {
    fetchMock.mockResolvedValue(userinfo(200, { sub: 'cus_REAL1' }))
    const res = await fetchHandler()(mcpRequest(forged('cus_CLAIMED')))
    expect(res.status).toBe(200)
    expect(seenAuth).toHaveLength(1)
    expect(seenAuth[0]).toMatchObject({ extra: { customer_ref: 'cus_REAL1' } })
  })

  it('answers 503, not a sign-in challenge, when SolvaPay cannot verify the token', async () => {
    fetchMock.mockResolvedValue(userinfo(500))
    const res = await fetchHandler()(mcpRequest(forged('cus_ANY')))
    expect(res.status).toBe(503)
    const body = (await res.json()) as { id: unknown; error: { code: number } }
    expect(body.id).toBe(7)
    expect(seenAuth).toHaveLength(0)
  })
})

describe('Express bridge: bearer tokens are verified with SolvaPay', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  async function run(token: string) {
    const middlewares = createMcpOAuthBridge({ publicBaseUrl, apiBaseUrl, productRef })
    const req: Record<string, unknown> = {
      method: 'POST',
      path: '/mcp',
      url: '/mcp',
      headers: { authorization: `Bearer ${token}` },
      body: { jsonrpc: '2.0', id: 7, method: 'tools/list' },
    }
    const state = { status: 200, body: undefined as unknown, nexted: false }
    const res = {
      status(code: number) {
        state.status = code
        return res
      },
      json(body: unknown) {
        state.body = body
      },
      setHeader() {},
      end() {},
      send() {},
    }
    for (const middleware of middlewares) {
      let calledNext = false
      await middleware(req as never, res as never, () => {
        calledNext = true
      })
      if (!calledNext) return { req, state }
    }
    state.nexted = true
    return { req, state }
  }

  it('challenges a forged token SolvaPay refuses', async () => {
    fetchMock.mockResolvedValue(userinfo(401))
    const { req, state } = await run(forged('cus_VICTIM'))
    expect(state.status).toBe(401)
    expect(state.nexted).toBe(false)
    expect(req.auth).toBeUndefined()
  })

  it('passes a valid token on as the customer SolvaPay names', async () => {
    fetchMock.mockResolvedValue(userinfo(200, { sub: 'cus_REAL1' }))
    const { req, state } = await run(forged('cus_CLAIMED'))
    expect(state.nexted).toBe(true)
    expect(req.auth).toMatchObject({ extra: { customer_ref: 'cus_REAL1' } })
  })

  it('answers 503 when SolvaPay cannot verify the token', async () => {
    fetchMock.mockResolvedValue(userinfo(502))
    const { state } = await run(forged('cus_ANY'))
    expect(state.status).toBe(503)
    expect(state.nexted).toBe(false)
  })
})
