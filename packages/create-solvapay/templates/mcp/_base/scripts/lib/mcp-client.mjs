/* global fetch */
/**
 * Minimal JSON-RPC over HTTP client for the MCP `streamable-http`
 * transport. Used by `verify.mjs` and `test.mjs` to talk to the
 * deployed (or `wrangler dev`) worker.
 *
 * Single-request POSTs with `Accept: application/json,
 * text/event-stream` — matches the SDK's `WebStandardStreamableHTTP`
 * stateless preset (the default in `createSolvaPayMcpFetch` with
 * `mode: 'json-stateless'`).
 *
 * No session pinning, no batching. Each call opens a fresh JSON-RPC
 * request and parses the JSON response (or first SSE `data:` line when
 * the server elects to stream).
 */

let nextId = 1

/**
 * Send a single JSON-RPC request to the worker and return the parsed
 * `result` (or throw on `error`).
 *
 * Accepts either the worker root (`https://my-worker.example.com`) or
 * the full MCP path (`https://my-worker.example.com/mcp`). When the
 * caller passes the root, `/mcp` is appended automatically to match
 * the SolvaPay SDK's default `mcpPath`. Workers that override
 * `mcpPath` need to pass the full URL.
 *
 * @param {string} workerUrl - base URL of the worker (no trailing slash).
 * @param {string} method - JSON-RPC method (e.g. `tools/list`).
 * @param {object} params - JSON-RPC params (defaults to {}).
 * @param {object} [options]
 * @param {string} [options.bearerToken] - OAuth bearer token. When
 *   present, the call is sent with `Authorization: Bearer <token>` so
 *   it can reach `tools/call` under the SDK default `requireAuth: true`
 *   (discovery methods like `tools/list` stay anonymous). Without it,
 *   `tools/call` is gated with a `WWW-Authenticate` challenge.
 */
export async function rpc(workerUrl, method, params = {}, options = {}) {
  const body = {
    jsonrpc: '2.0',
    id: nextId++,
    method,
    params,
  }
  const url = toMcpEndpoint(workerUrl)
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  }
  if (options.bearerToken) {
    headers.authorization = `Bearer ${options.bearerToken}`
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new RpcError(`HTTP ${res.status} from ${url}`, {
      httpStatus: res.status,
      body: text,
      wwwAuthenticate: res.headers.get('www-authenticate'),
    })
  }
  const payload = await readJsonOrSse(res)
  if (payload.error) {
    throw new RpcError(payload.error.message ?? 'JSON-RPC error', {
      code: payload.error.code,
      data: payload.error.data,
    })
  }
  return payload.result
}

function toMcpEndpoint(workerUrl) {
  const trimmed = workerUrl.replace(/\/$/, '')
  return trimmed.endsWith('/mcp') ? trimmed : `${trimmed}/mcp`
}

/**
 * GET a public endpoint (used for the `/.well-known/...` OAuth metadata
 * checks in verify.mjs). Returns the parsed JSON body or throws.
 *
 * Accepts an optional `bearerToken` for symmetry with `rpc()`. The
 * OAuth discovery endpoints are public so the token is not used today,
 * but keeping the signature symmetric lets callers pass a single
 * options object through every helper.
 */
export async function getJson(url, options = {}) {
  const headers = { accept: 'application/json' }
  if (options.bearerToken) {
    headers.authorization = `Bearer ${options.bearerToken}`
  }
  const res = await fetch(url, { headers })
  if (!res.ok) {
    throw new RpcError(`HTTP ${res.status} from ${url}`, { httpStatus: res.status })
  }
  return res.json()
}

/**
 * `tools/list` convenience — returns the array of tool descriptors.
 * Pass `{ bearerToken }` to reach a worker with the SDK default
 * `requireAuth: true`.
 */
export async function listTools(workerUrl, options = {}) {
  const result = await rpc(workerUrl, 'tools/list', {}, options)
  return Array.isArray(result?.tools) ? result.tools : []
}

/**
 * `tools/call` convenience — returns the full result envelope so the
 * caller can introspect `content[0].text`, `structuredContent`, and
 * `isError`. Pass `{ bearerToken }` to call protected tools.
 */
export async function callTool(workerUrl, name, args, options = {}) {
  return rpc(workerUrl, 'tools/call', { name, arguments: args }, options)
}

export class RpcError extends Error {
  constructor(message, info = {}) {
    super(message)
    this.name = 'RpcError'
    this.info = info
  }
}

async function readJsonOrSse(res) {
  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return res.json()
  }
  // `text/event-stream` (server elected to stream). The SDK's stateless
  // mode emits one `data:` frame then closes — parse the first frame.
  const text = await res.text()
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('data:')) {
      const json = line.slice(5).trim()
      if (json) return JSON.parse(json)
    }
  }
  throw new RpcError('No JSON-RPC payload in response', { body: text.slice(0, 500) })
}
