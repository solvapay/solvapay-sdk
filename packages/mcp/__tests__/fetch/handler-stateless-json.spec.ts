/**
 * End-to-end coverage for `createSolvaPayMcpFetchHandler({ mode:
 * 'json-stateless' })`. Unlike `handler.spec.ts` which mocks the
 * transport to cover the OAuth / CORS / auth-guard surface, this suite
 * exercises the real `WebStandardStreamableHTTPServerTransport` +
 * `McpServer` wiring so the mode/close/mutex interaction is
 * regression-tested end-to-end (initialize → notifications/initialized
 * → tools/list → tools/call, plus a concurrency check to guard against
 * "Already connected to a transport" re-entry bugs).
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createSolvaPayMcpFetchHandler } from '../../src/fetch/handler'

const publicBaseUrl = 'https://mcp.example.com'
const apiBaseUrl = 'https://api.solvapay.com'
const productRef = 'prd_test_stateless'

function buildEchoServer(): McpServer {
  const server = new McpServer({ name: 'test-stateless', version: '0.0.0' })
  server.registerTool(
    'echo',
    {
      title: 'Echo',
      description: 'Echoes back the provided message.',
      inputSchema: { message: z.string() },
    },
    async ({ message }) => ({
      content: [{ type: 'text' as const, text: message }],
    }),
  )
  return server
}

function buildHandler(): (req: Request) => Promise<Response> {
  return createSolvaPayMcpFetchHandler({
    server: buildEchoServer(),
    publicBaseUrl,
    apiBaseUrl,
    productRef,
    mode: 'json-stateless',
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
): Promise<{ status: number; json: JsonRpcResponse<T> }> {
  const res = await handler(rpcRequest(body))
  return { status: res.status, json: (await res.json()) as JsonRpcResponse<T> }
}

interface InitializeResult {
  serverInfo?: { name?: string; version?: string }
  protocolVersion?: string
  capabilities?: Record<string, unknown>
}

interface ToolsListResult {
  tools: Array<{ name: string; description?: string }>
}

interface ToolsCallResult {
  content: Array<{ type: string; text?: string }>
}

describe('createSolvaPayMcpFetchHandler — mode: json-stateless', () => {
  it('completes initialize → initialized → tools/list → tools/call against a real McpServer', async () => {
    const handler = buildHandler()

    // 1) initialize → 200 + JSON body with serverInfo
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

    // 2) notifications/initialized is a JSON-RPC notification (no id) →
    //    202 Accepted with no body per the MCP transport spec.
    const initializedRes = await handler(
      rpcRequest({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }),
    )
    expect(initializedRes.status).toBe(202)

    // 3) tools/list → 200 + JSON body with the echo tool present
    const list = await callRpc<ToolsListResult>(handler, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    })
    expect(list.status).toBe(200)
    expect(list.json.result?.tools?.map(t => t.name)).toContain('echo')

    // 4) tools/call → 200 + JSON body with the echo result
    const call = await callRpc<ToolsCallResult>(handler, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'echo', arguments: { message: 'hello' } },
    })
    expect(call.status).toBe(200)
    expect(call.json.result?.content?.[0]).toMatchObject({ type: 'text', text: 'hello' })
  })

  it('survives 50 concurrent tools/list calls without "Already connected" errors', async () => {
    const handler = buildHandler()

    // Initialize first so subsequent calls aren't rejected by the
    // transport's session validator on the first fan-out request.
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
      // A re-entry bug surfaces as a JSON-RPC error with
      // `Already connected to a transport` on `result.error.message`.
      // The mutex + transport.close() in the handler's finally block
      // keeps the server's `_transport` slot free for the next request,
      // so every call here should carry a clean `tools` result.
      expect(r.json.error).toBeUndefined()
      expect(r.json.result?.tools?.map(t => t.name)).toContain('echo')
    }
  })
})
