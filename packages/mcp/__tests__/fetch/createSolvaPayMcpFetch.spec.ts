/**
 * End-to-end coverage for the unified `createSolvaPayMcpFetch` factory.
 *
 * Exercises the full descriptor-driven path against the real
 * `WebStandardStreamableHTTPServerTransport` + `McpServer` wiring —
 * no SDK mocks. The suite proves the architectural claim that edge
 * consumers can wire up a paywalled MCP server importing ONLY from
 * `@solvapay/mcp/fetch` (+ `@solvapay/server` for the factory input
 * + `@solvapay/mcp-core` for the tool-name constants): the
 * `"does not leak @solvapay/mcp into the import surface"` test at
 * the bottom of this file parses its own source and asserts the
 * absence of any bare `@solvapay/mcp` import (the root `.` entry
 * would drag in `registerPayableTool` + its zod-compat wiring, which
 * is exactly what the `./fetch` subpath is meant to avoid).
 */
import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { MCP_TOOL_NAMES, SOLVAPAY_BOOTSTRAP_URI } from '@solvapay/mcp-core'
import { createSolvaPay } from '@solvapay/server'
import type { SolvaPayClient } from '@solvapay/server'
import { createSolvaPayMcpFetch } from '../../src/fetch/createSolvaPayMcpFetch'

const publicBaseUrl = 'https://mcp.example.com'
const apiBaseUrl = 'https://api.solvapay.com'
const productRef = 'prd_test_factory'
const resourceUri = 'ui://test/app.html'

function makeSolvaPay() {
  const client = {
    checkLimits: vi.fn().mockResolvedValue({ withinLimits: true, remaining: 1, plan: 'free' }),
    trackUsage: vi.fn().mockResolvedValue(undefined),
    createCustomer: vi.fn().mockResolvedValue({ customerRef: 'cus_new' }),
    getCustomer: vi.fn().mockResolvedValue({ customerRef: 'cus_existing' }),
    createCheckoutSession: vi
      .fn()
      .mockResolvedValue({ sessionId: 'sess_1', checkoutUrl: 'https://example.com/sess_1' }),
    getPlatformConfig: vi.fn().mockResolvedValue({ stripePublishableKey: 'pk_test_123' }),
    getMerchant: vi.fn().mockResolvedValue({ displayName: 'Acme', legalName: 'Acme Inc' }),
    getProduct: vi.fn().mockResolvedValue({ reference: productRef, name: 'Test product' }),
    listPlans: vi.fn().mockResolvedValue([{ reference: 'pln_basic', name: 'Basic' }]),
    getPaymentMethod: vi.fn().mockResolvedValue({ kind: 'none' }),
    getCustomerBalance: vi.fn().mockResolvedValue({
      customerRef: 'cus_existing',
      credits: 0,
      displayCurrency: 'USD',
      creditsPerMinorUnit: 1,
      displayExchangeRate: 1,
    }),
  } as unknown as SolvaPayClient
  return createSolvaPay({ apiClient: client })
}

function buildHandler(
  overrides: Partial<Parameters<typeof createSolvaPayMcpFetch>[0]> = {},
): (req: Request) => Promise<Response> {
  return createSolvaPayMcpFetch({
    solvaPay: makeSolvaPay(),
    productRef,
    resourceUri,
    readHtml: async () => '<html><body>test</body></html>',
    publicBaseUrl,
    apiBaseUrl,
    requireAuth: false,
    mode: 'json-stateless',
    ...overrides,
  })
}

interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0'
  id: string | number | null
  result?: T
  error?: { code: number; message: string }
}

async function callRpc<T>(
  handler: (req: Request) => Promise<Response>,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; json: JsonRpcResponse<T> }> {
  const res = await handler(
    new Request(`${publicBaseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    }),
  )
  return { status: res.status, json: (await res.json()) as JsonRpcResponse<T> }
}

// Alias of `callRpc` for tests that want to be explicit they're
// asserting on a 200 response shape.
async function fetch200<T = unknown>(
  handler: (req: Request) => Promise<Response>,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; json: JsonRpcResponse<T> }> {
  return callRpc<T>(handler, body, extraHeaders)
}

async function initialize(handler: (req: Request) => Promise<Response>) {
  return callRpc<{ serverInfo?: { name?: string; icons?: Array<{ src: string }> } }>(
    handler,
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '0.0.0' },
      },
    },
  )
}

const INTENT_TOOLS = [
  MCP_TOOL_NAMES.upgrade,
  MCP_TOOL_NAMES.manageAccount,
  MCP_TOOL_NAMES.topup,
  MCP_TOOL_NAMES.activatePlan,
]

const UI_TOOLS = [
  MCP_TOOL_NAMES.createCheckoutSession,
  MCP_TOOL_NAMES.createPayment,
  MCP_TOOL_NAMES.processPayment,
  MCP_TOOL_NAMES.createCustomerSession,
  MCP_TOOL_NAMES.createTopupPayment,
  MCP_TOOL_NAMES.cancelRenewal,
  MCP_TOOL_NAMES.reactivateRenewal,
]

interface ToolsListResult {
  tools: Array<{ name: string; _meta?: { audience?: unknown } }>
}

interface ResourceReadResult {
  contents: Array<{
    uri: string
    mimeType: string
    text?: string
    _meta?: { ui?: { csp?: unknown; prefersBorder?: boolean } }
  }>
}

interface ToolCallResult {
  content: Array<{ type: string; text?: string }>
  structuredContent?: unknown
  _meta?: { ui?: { resourceUri?: string } }
}

describe('createSolvaPayMcpFetch', () => {
  describe('method-aware auth (requireAuth default)', () => {
    function makeJwt(sub: string) {
      return (
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
        Buffer.from(JSON.stringify({ sub, exp: 9_999_999_999 })).toString('base64url') +
        '.sig'
      )
    }

    it('allows anonymous initialize when requireAuth defaults to true', async () => {
      const handler = buildHandler({ requireAuth: true })
      const res = await initialize(handler)
      expect(res.status).toBe(200)
      expect(res.json.result?.serverInfo?.name).toBe('solvapay-mcp-server')
    })

    it('allows anonymous tools/list when requireAuth defaults to true', async () => {
      const handler = buildHandler({ requireAuth: true })
      await initialize(handler)
      const list = await callRpc<ToolsListResult>(handler, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      })
      expect(list.status).toBe(200)
      expect(list.json.result?.tools?.length).toBeGreaterThan(0)
    })

    it('challenges anonymous tools/call with 401 + Unauthorized', async () => {
      const handler = buildHandler({ requireAuth: true })
      await initialize(handler)
      const call = await callRpc(handler, {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: MCP_TOOL_NAMES.upgrade, arguments: {} },
      })
      expect(call.status).toBe(401)
      expect(call.json.error?.code).toBe(-32001)
      expect(call.json.error?.message).toBe('Unauthorized')
    })

    it('allows authenticated tools/call through', async () => {
      const handler = buildHandler({ requireAuth: true })
      const auth = { authorization: `Bearer ${makeJwt('cust_1')}` }
      await callRpc(handler, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '0.0.0' },
        },
      }, auth)
      const call = await callRpc<ToolCallResult>(
        handler,
        {
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: { name: MCP_TOOL_NAMES.upgrade, arguments: {} },
        },
        auth,
      )
      expect(call.status).toBe(200)
      expect(call.json.result ?? call.json.error).toBeDefined()
    })
  })

  it('initialize → 200 + serverInfo with default name', async () => {
    const handler = buildHandler()
    const res = await initialize(handler)
    expect(res.status).toBe(200)
    expect(res.json.result?.serverInfo?.name).toBe('solvapay-mcp-server')
  })

  it('initialize → serverInfo picks up branding.brandName + icons', async () => {
    const handler = buildHandler({
      branding: {
        brandName: 'Acme Test',
        iconUrl: 'https://cdn.acme.test/icon.png',
      },
    })
    const res = await initialize(handler)
    expect(res.status).toBe(200)
    expect(res.json.result?.serverInfo?.name).toBe('Acme Test')
    expect(res.json.result?.serverInfo?.icons?.[0]?.src).toBe('https://cdn.acme.test/icon.png')
  })

  it('tools/list returns all 11 SolvaPay tools by default', async () => {
    const handler = buildHandler()
    const init = await initialize(handler)
    expect(init.status).toBe(200)

    const list = await callRpc<ToolsListResult>(handler, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    })
    expect(list.status).toBe(200)
    const names = list.json.result?.tools?.map(t => t.name) ?? []
    for (const name of [...INTENT_TOOLS, ...UI_TOOLS]) {
      expect(names).toContain(name)
    }
  })

  it('tools/list drops audience=ui tools when hideToolsByAudience=["ui"]', async () => {
    const handler = buildHandler({ hideToolsByAudience: ['ui'] })
    await initialize(handler)

    const list = await callRpc<ToolsListResult>(handler, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    })
    expect(list.status).toBe(200)
    const names = list.json.result?.tools?.map(t => t.name) ?? []
    for (const intent of INTENT_TOOLS) {
      expect(names).toContain(intent)
    }
    for (const uiTool of UI_TOOLS) {
      expect(names).not.toContain(uiTool)
    }
  })

  it('tools/list bypasses hideToolsByAudience for ChatGPT-originated requests (User-Agent /openai-mcp/i)', async () => {
    // Verified against `openai-mcp/1.0.0 (ChatGPT)` on goldberg-demo
    // prod (Phase A probe, 2026-05-04). The fetch handler must
    // propagate the User-Agent through `RequestHandlerExtra.requestInfo`
    // so the audience filter can detect ChatGPT and serve the full
    // catalog — without this, the iframe's transport tools would be
    // uncallable on ChatGPT and the user sees `MCP error -32000`.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const handler = buildHandler({ hideToolsByAudience: ['ui'] })
      const initRes = await fetch200(handler, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '0.0.0' },
        },
      })
      expect(initRes.status).toBe(200)

      const list = await fetch200<ToolsListResult>(
        handler,
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        { 'user-agent': 'openai-mcp/1.0.0 (ChatGPT)' },
      )
      expect(list.status).toBe(200)
      const names = list.json.result?.tools?.map(t => t.name) ?? []
      for (const tool of [...INTENT_TOOLS, ...UI_TOOLS]) {
        expect(names).toContain(tool)
      }
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/hideToolsByAudience filter bypassed/),
      )
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('resources/read returns the registered UI HTML with prefersBorder: false', async () => {
    const handler = buildHandler()
    await initialize(handler)

    const read = await callRpc<ResourceReadResult>(handler, {
      jsonrpc: '2.0',
      id: 3,
      method: 'resources/read',
      params: { uri: resourceUri },
    })
    expect(read.status).toBe(200)
    const entry = read.json.result?.contents?.[0]
    expect(entry?.uri).toBe(resourceUri)
    expect(entry?.text).toContain('<html><body>test</body></html>')
    expect(entry?._meta?.ui?.prefersBorder).toBe(false)
  })

  it('resources/read returns bootstrap JSON at solvapay://bootstrap.json', async () => {
    const handler = buildHandler()
    await initialize(handler)

    const read = await callRpc<ResourceReadResult>(handler, {
      jsonrpc: '2.0',
      id: 31,
      method: 'resources/read',
      params: { uri: SOLVAPAY_BOOTSTRAP_URI },
    })
    expect(read.status).toBe(200)
    const entry = read.json.result?.contents?.[0]
    expect(entry?.uri).toBe(SOLVAPAY_BOOTSTRAP_URI)
    expect(entry?.mimeType).toBe('application/json')
    const payload = JSON.parse(entry?.text ?? '{}') as { productRef?: string; returnUrl?: string }
    expect(payload.productRef).toBe(productRef)
    expect(payload.returnUrl).toBe(publicBaseUrl)
  })

  it('tools/call reaches the upgrade intent handler with default mode', async () => {
    const handler = buildHandler()
    await initialize(handler)

    const call = await callRpc<ToolCallResult>(handler, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: MCP_TOOL_NAMES.upgrade, arguments: {} },
    })
    // The handler may return either a success envelope (narrated +
    // structured bootstrap payload) or a 401 wrapped in the error
    // path when the fake SolvaPay client rejects auth — either way we
    // just need to prove the call was routed through to the tool and
    // returned a valid JSON-RPC frame so the factory's wiring is
    // regression-tested.
    expect(call.status).toBe(200)
    expect(call.json.jsonrpc).toBe('2.0')
    expect(call.json.id).toBe(4)
    expect(call.json.result ?? call.json.error).toBeDefined()
  })

  it('invokes the additionalTools hook with { server, solvaPay, resourceUri, productRef }', async () => {
    const additional = vi.fn()
    buildHandler({ additionalTools: additional })
    expect(additional).toHaveBeenCalledOnce()
    const ctx = additional.mock.calls[0][0]
    expect(ctx.productRef).toBe(productRef)
    expect(ctx.resourceUri).toBe(resourceUri)
    expect(typeof ctx.server?.registerTool).toBe('function')
    expect(typeof ctx.solvaPay).toBe('object')
  })

  it('registerPrompts: false skips slash-command prompt registration', async () => {
    const handler = buildHandler({ registerPrompts: false })
    await initialize(handler)

    const list = await callRpc<{ prompts: Array<{ name: string }> }>(handler, {
      jsonrpc: '2.0',
      id: 2,
      method: 'prompts/list',
    })
    // Two possible shapes: 200 with empty prompts array, or a
    // method-not-found error when no prompts were registered at all.
    // Either way, no SolvaPay prompt names should leak through.
    const names = list.json.result?.prompts?.map(p => p.name) ?? []
    for (const intent of INTENT_TOOLS) {
      expect(names).not.toContain(intent)
    }
  })

  it('registerDocsResources: false skips the docs://solvapay/overview.md resource', async () => {
    const handler = buildHandler({ registerDocsResources: false })
    await initialize(handler)

    const list = await callRpc<{
      resources: Array<{ uri: string }>
    }>(handler, {
      jsonrpc: '2.0',
      id: 2,
      method: 'resources/list',
    })
    const uris = list.json.result?.resources?.map(r => r.uri) ?? []
    expect(uris).not.toContain('docs://solvapay/overview.md')
    expect(uris).toContain(resourceUri)
  })

  it('does not leak @solvapay/mcp into the import surface (architectural guarantee)', async () => {
    // The unified factory exists so edge consumers can import ONLY
    // from `@solvapay/mcp/fetch`. Assert this test file itself doesn't
    // reach into `@solvapay/mcp` (the root `.` entry) — if anyone
    // adds a convenience import here the guarantee quietly breaks
    // for their consumers, since the root entry carries
    // `registerPayableTool` + its zod-compat + payable-handler wiring
    // that the subpath is meant to leave behind.
    const source = await readFile(path.resolve(__dirname, 'createSolvaPayMcpFetch.spec.ts'), 'utf-8')
    expect(source).not.toMatch(/from\s+['"]@solvapay\/mcp['"]/)
  })

  it('passes mode: json-stateless through to the underlying handler (no sessionId header on initialize)', async () => {
    const handler = buildHandler({ mode: 'json-stateless' })
    const res = await handler(
      new Request(`${publicBaseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '0.0.0' },
          },
        }),
      }),
    )
    expect(res.status).toBe(200)
    // Stateless mode MUST NOT echo an `mcp-session-id` header —
    // presence of one indicates the transport fell back to stateful
    // mode and the factory wired the mode option incorrectly.
    expect(res.headers.get('mcp-session-id')).toBeNull()
  })
})
