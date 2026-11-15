/**
 * Minimal JSON-RPC over HTTP client for the MCP streamable-http transport,
 * used by `solvapay verify`. One POST per call, no session pinning, no
 * batching. Parses a JSON response or the first SSE `data:` frame.
 *
 * Taken from the TypeScript MCP template's `scripts/lib/mcp-client.mjs`, so
 * one verifier covers servers in every language.
 */

export type RpcOptions = { bearerToken?: string }

export type RpcErrorInfo = {
  httpStatus?: number
  body?: string
  wwwAuthenticate?: string | null
  code?: number
  data?: unknown
}

export class RpcError extends Error {
  readonly info: RpcErrorInfo
  constructor(message: string, info: RpcErrorInfo = {}) {
    super(message)
    this.name = 'RpcError'
    this.info = info
  }
}

export type ToolDescriptor = { name: string }

export type ToolCallResult = {
  content?: Array<{ type: string; text?: string }>
  structuredContent?: Record<string, unknown>
  isError?: boolean
  _meta?: Record<string, unknown>
}

let nextId = 1

/** `https://host` or `https://host/mcp` → the MCP endpoint (`/mcp` appended to a bare root). */
export const toMcpEndpoint = (serverUrl: string): string => {
  const trimmed = serverUrl.replace(/\/$/, '')
  return trimmed.endsWith('/mcp') ? trimmed : `${trimmed}/mcp`
}

/** The server's origin, for the `/.well-known/*` documents. */
export const toServerRoot = (serverUrl: string): string =>
  serverUrl.replace(/\/$/, '').replace(/\/mcp$/, '')

const readJsonOrSse = async (res: Response): Promise<Record<string, unknown>> => {
  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return (await res.json()) as Record<string, unknown>
  }
  const text = await res.text()
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('data:')) {
      const json = line.slice(5).trim()
      if (json) return JSON.parse(json) as Record<string, unknown>
    }
  }
  throw new RpcError('No JSON-RPC payload in response', { body: text.slice(0, 500) })
}

export const rpc = async (
  serverUrl: string,
  method: string,
  params: Record<string, unknown> = {},
  options: RpcOptions = {},
): Promise<unknown> => {
  const url = toMcpEndpoint(serverUrl)
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  }
  if (options.bearerToken) headers.authorization = `Bearer ${options.bearerToken}`
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new RpcError(`HTTP ${res.status} from ${url}`, {
      httpStatus: res.status,
      body,
      wwwAuthenticate: res.headers.get('www-authenticate'),
    })
  }
  const payload = await readJsonOrSse(res)
  const error = payload.error as { message?: string; code?: number; data?: unknown } | undefined
  if (error) {
    throw new RpcError(error.message ?? 'JSON-RPC error', { code: error.code, data: error.data })
  }
  return payload.result
}

export const getJson = async (url: string): Promise<Record<string, unknown>> => {
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new RpcError(`HTTP ${res.status} from ${url}`, { httpStatus: res.status })
  return (await res.json()) as Record<string, unknown>
}

export const listTools = async (
  serverUrl: string,
  options: RpcOptions = {},
): Promise<ToolDescriptor[]> => {
  const result = (await rpc(serverUrl, 'tools/list', {}, options)) as { tools?: unknown } | null
  return Array.isArray(result?.tools) ? (result.tools as ToolDescriptor[]) : []
}

export const callTool = async (
  serverUrl: string,
  name: string,
  args: Record<string, unknown>,
  options: RpcOptions = {},
): Promise<ToolCallResult> =>
  (await rpc(serverUrl, 'tools/call', { name, arguments: args }, options)) as ToolCallResult
