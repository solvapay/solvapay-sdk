/**
 * End-to-end coverage for `createSolvaPayMcpFetchHandler({ responseMode: 'json' })`.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  McpServer,
  PROTOCOL_VERSION_META_KEY,
} from '@modelcontextprotocol/server'
import { createSolvaPayMcpFetchHandler } from '../../src/fetch/handler'

/** The 2026-era revision this SDK serves on the modern path. */
const MODERN_PROTOCOL_VERSION = '2026-07-28'

const publicBaseUrl = 'https://mcp.example.com'
const apiBaseUrl = 'https://api.solvapay.com'
const productRef = 'prd_test_stateless'

function buildEchoFactory() {
  return () => {
    const server = new McpServer({ name: 'test-stateless', version: '0.0.0' })
    server.registerTool(
      'echo',
      {
        title: 'Echo',
        description: 'Echoes back the provided message.',
        inputSchema: z.object({ message: z.string() }),
      },
      async ({ message }) => ({
        content: [{ type: 'text' as const, text: message }],
      }),
    )
    server.registerTool(
      'reverse',
      {
        title: 'Reverse',
        description: 'Reverses the provided message.',
        inputSchema: z.object({ message: z.string() }),
      },
      async ({ message }) => ({
        content: [{ type: 'text' as const, text: message.split('').reverse().join('') }],
      }),
    )
    return server
  }
}

function buildHandler(): (req: Request) => Promise<Response> {
  return createSolvaPayMcpFetchHandler({
    factory: buildEchoFactory(),
    publicBaseUrl,
    apiBaseUrl,
    productRef,
    responseMode: 'json',
    requireAuth: false,
  })
}

interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0'
  id: string | number | null
  result?: T
  error?: { code: number; message: string }
}

function rpcRequest(body: unknown): Request {
  return new Request(`${publicBaseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(body),
  })
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

interface InitializeResult {
  serverInfo?: { name?: string; version?: string }
  protocolVersion?: string
  capabilities?: Record<string, unknown>
}

interface ToolsListResult {
  tools: Array<{ name: string; description?: string; inputSchema?: unknown }>
}

interface ToolsCallResult {
  content: Array<{ type: string; text?: string }>
}

describe('createSolvaPayMcpFetchHandler — responseMode: json (legacy era)', () => {
  it('completes initialize → initialized → tools/list → tools/call', async () => {
    const handler = buildHandler()

    const init = await callRpc<InitializeResult>(handler, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '0.0.0' },
      },
    })
    expect(init.status).toBe(200)
    expect(init.json.result?.serverInfo?.name).toBe('test-stateless')

    const initializedRes = await handler(
      rpcRequest({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }),
    )
    expect(initializedRes.status).toBe(202)

    const list = await callRpc<ToolsListResult>(handler, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    })
    expect(list.status).toBe(200)
    expect(list.json.result?.tools?.map(t => t.name)).toContain('echo')
    for (const tool of list.json.result?.tools ?? []) {
      expect(tool.inputSchema, tool.name).toEqual(expect.objectContaining({ type: 'object' }))
    }

    const call = await callRpc<ToolsCallResult>(handler, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'echo', arguments: { message: 'hello' } },
    })
    expect(call.status).toBe(200)
    expect(call.json.result?.content?.[0]).toMatchObject({ type: 'text', text: 'hello' })
  })

  it('chains two tools/call requests without minting Mcp-Session-Id', async () => {
    const handler = buildHandler()

    const init = await callRpc<InitializeResult>(handler, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '0.0.0' },
      },
    })
    expect(init.status).toBe(200)

    const initHeaderRes = await handler(
      rpcRequest({
        jsonrpc: '2.0',
        id: 10,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '0.0.0' },
        },
      }),
    )
    expect(initHeaderRes.headers.get('mcp-session-id')).toBeNull()

    const initializedRes = await handler(
      rpcRequest({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }),
    )
    expect(initializedRes.status).toBe(202)

    const callA = await callRpc<ToolsCallResult>(handler, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'echo', arguments: { message: 'hello' } },
    })
    expect(callA.status).toBe(200)
    expect(callA.json.error).toBeUndefined()
    expect(callA.json.result?.content?.[0]).toMatchObject({ type: 'text', text: 'hello' })

    const callB = await callRpc<ToolsCallResult>(handler, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'reverse', arguments: { message: 'hello' } },
    })
    expect(callB.status).toBe(200)
    expect(callB.json.error).toBeUndefined()
    expect(callB.json.result?.content?.[0]).toMatchObject({ type: 'text', text: 'olleh' })
  })

  it('survives 50 concurrent tools/list calls without transport errors', async () => {
    const handler = buildHandler()

    const init = await callRpc<InitializeResult>(handler, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '0.0.0' },
      },
    })
    expect(init.status).toBe(200)

    const calls = Array.from({ length: 50 }, (_, i) =>
      callRpc<ToolsListResult>(handler, {
        jsonrpc: '2.0',
        id: 1000 + i,
        method: 'tools/list',
      }),
    )
    const results = await Promise.all(calls)

    for (const r of results) {
      expect(r.status).toBe(200)
      expect(r.json.error).toBeUndefined()
      expect(r.json.result?.tools?.map(t => t.name)).toContain('echo')
    }
  })
})

describe('createSolvaPayMcpFetchHandler — modern era (2026-07-28)', () => {
  /**
   * Modern requests carry no `initialize` handshake — each one self-describes
   * through the namespaced `_meta` envelope, and the presence of that claim is
   * what routes the request to the modern path instead of the legacy leg.
   */
  function modernMeta(): Record<string, unknown> {
    return {
      [PROTOCOL_VERSION_META_KEY]: MODERN_PROTOCOL_VERSION,
      [CLIENT_INFO_META_KEY]: { name: 'modern-client', version: '1.0.0' },
      [CLIENT_CAPABILITIES_META_KEY]: {},
    }
  }

  /**
   * The modern path cross-checks routing headers against the body and answers
   * `-32020` on any disagreement — including an *absent* header for a value the
   * body carries. `tools/call` therefore needs `Mcp-Name` alongside
   * `Mcp-Method`, mirroring `params.name`.
   */
  function modernHeaders(method: string, name?: string): Record<string, string> {
    return {
      'mcp-method': method,
      'mcp-protocol-version': MODERN_PROTOCOL_VERSION,
      ...(name !== undefined ? { 'mcp-name': name } : {}),
    }
  }

  it('round-trips tools/list with no initialize handshake', async () => {
    const handler = buildHandler()

    const list = await callRpc<ToolsListResult>(
      handler,
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: { _meta: modernMeta() },
      },
      modernHeaders('tools/list'),
    )

    expect(list.status).toBe(200)
    expect(list.json.error).toBeUndefined()
    expect(list.json.result?.tools?.map(t => t.name)).toEqual(
      expect.arrayContaining(['echo', 'reverse']),
    )
  })

  it('round-trips tools/call', async () => {
    const handler = buildHandler()

    const call = await callRpc<ToolsCallResult>(
      handler,
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'reverse',
          arguments: { message: 'hello' },
          _meta: modernMeta(),
        },
      },
      modernHeaders('tools/call', 'reverse'),
    )

    expect(call.status).toBe(200)
    expect(call.json.error).toBeUndefined()
    expect(call.json.result?.content?.[0]).toMatchObject({ type: 'text', text: 'olleh' })
  })

  it('rejects a body whose method disagrees with the Mcp-Method header', async () => {
    const handler = buildHandler()

    const list = await callRpc<ToolsListResult>(
      handler,
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/list',
        params: { _meta: modernMeta() },
      },
      modernHeaders('tools/call'),
    )

    expect(list.status).toBe(400)
    expect(list.json.error?.code).toBe(-32020)
  })

  it('rejects an envelope naming a revision the endpoint does not serve', async () => {
    const handler = buildHandler()

    const list = await callRpc<ToolsListResult>(
      handler,
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/list',
        params: {
          _meta: { ...modernMeta(), [PROTOCOL_VERSION_META_KEY]: '2999-01-01' },
        },
      },
      { 'mcp-method': 'tools/list' },
    )

    expect(list.json.result).toBeUndefined()
    expect(list.json.error).toBeDefined()
  })
})
