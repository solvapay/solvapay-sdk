/**
 * Minimal MCP client for the streamable-http transport, used by
 * `solvapay verify`. It connects the way MCP hosts (Claude, ChatGPT) do today:
 * an `initialize` handshake, `notifications/initialized`, then every request
 * carries the `mcp-session-id` the server issued (if it issued one) and the
 * negotiated `mcp-protocol-version`. So one verifier covers stateless servers
 * (TypeScript on Workers) and stateful ones (the Python and Go SDKs' defaults).
 *
 * Responses are JSON or SSE. In an SSE stream the response is the frame whose
 * `id` matches the request; notifications before it are skipped.
 */

/** The newest protocol revision every SDK still reaches through `initialize`. */
export const HANDSHAKE_PROTOCOL_VERSION = '2025-11-25'

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

/** The subset of JSON Schema `verify` reads to build probe arguments. */
export type JsonSchema = {
  type?: string | string[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  enum?: unknown[]
  const?: unknown
  default?: unknown
  format?: string
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number
  minLength?: number
  minItems?: number
}

export type ToolDescriptor = {
  name: string
  inputSchema?: JsonSchema
  _meta?: Record<string, unknown>
}

export type ToolCallResult = {
  content?: Array<{ type: string; text?: string }>
  structuredContent?: Record<string, unknown>
  isError?: boolean
  _meta?: Record<string, unknown>
}

export type McpSession = {
  /** The session id the server issued, or undefined for a stateless server. */
  readonly sessionId: string | undefined
  readonly protocolVersion: string
  listTools: () => Promise<ToolDescriptor[]>
  callTool: (name: string, args: Record<string, unknown>) => Promise<ToolCallResult>
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

const readResponse = async (res: Response, id: number): Promise<Record<string, unknown>> => {
  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return (await res.json()) as Record<string, unknown>
  }
  const text = await res.text()
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue
    const json = line.slice(5).trim()
    if (!json) continue
    const message = JSON.parse(json) as Record<string, unknown>
    if (message.id === id) return message
  }
  throw new RpcError(`No JSON-RPC response with id ${id} in the response`, {
    body: text.slice(0, 500),
  })
}

const post = async (
  url: string,
  message: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<Response> => {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: '2.0', ...message }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new RpcError(`HTTP ${res.status} from ${url}`, {
      httpStatus: res.status,
      body,
      wwwAuthenticate: res.headers.get('www-authenticate'),
    })
  }
  return res
}

const request = async (
  url: string,
  method: string,
  params: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<{ result: unknown; res: Response }> => {
  const id = nextId++
  const res = await post(url, { id, method, params }, headers)
  const payload = await readResponse(res, id)
  const error = payload.error as { message?: string; code?: number; data?: unknown } | undefined
  if (error) {
    throw new RpcError(error.message ?? 'JSON-RPC error', { code: error.code, data: error.data })
  }
  return { result: payload.result, res }
}

/**
 * Opens an MCP session: `initialize`, then `notifications/initialized`.
 * A 401 from `initialize` throws an `RpcError` carrying the status and the
 * `WWW-Authenticate` challenge, so callers can check the sign-in contract.
 */
export const openSession = async (
  serverUrl: string,
  options: RpcOptions = {},
): Promise<McpSession> => {
  const url = toMcpEndpoint(serverUrl)
  const auth: Record<string, string> = options.bearerToken
    ? { authorization: `Bearer ${options.bearerToken}` }
    : {}

  const { result, res } = await request(
    url,
    'initialize',
    {
      protocolVersion: HANDSHAKE_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'solvapay-verify', version: '1' },
    },
    auth,
  )
  const protocolVersion = (result as { protocolVersion?: unknown } | null)?.protocolVersion
  if (typeof protocolVersion !== 'string' || protocolVersion.length === 0) {
    throw new RpcError('initialize returned no protocolVersion', {
      body: JSON.stringify(result).slice(0, 500),
    })
  }
  const sessionId = res.headers.get('mcp-session-id') ?? undefined
  const headers: Record<string, string> = {
    ...auth,
    'mcp-protocol-version': protocolVersion,
    ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
  }

  await post(url, { method: 'notifications/initialized' }, headers)

  return {
    sessionId,
    protocolVersion,
    listTools: async () => {
      const { result: list } = await request(url, 'tools/list', {}, headers)
      const tools = (list as { tools?: unknown } | null)?.tools
      return Array.isArray(tools) ? (tools as ToolDescriptor[]) : []
    },
    callTool: async (name, args) =>
      (await request(url, 'tools/call', { name, arguments: args }, headers))
        .result as ToolCallResult,
  }
}

export const getJson = async (url: string): Promise<Record<string, unknown>> => {
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new RpcError(`HTTP ${res.status} from ${url}`, { httpStatus: res.status })
  return (await res.json()) as Record<string, unknown>
}
