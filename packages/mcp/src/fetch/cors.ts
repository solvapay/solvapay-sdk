/**
 * Native-scheme CORS preflight + 401 `WWW-Authenticate` helpers for MCP
 * clients on Web-standards runtimes.
 *
 * MCP clients like Cursor, VS Code, and Claude Desktop attach native
 * schemes to their DCR / OAuth flows (`cursor://…`, `vscode://…`,
 * `vscode-webview://…`, `claude://…`). These origins don't carry
 * credentials — mirroring them back in `Access-Control-Allow-Origin` is
 * safer than a bare `*`.
 */

import { withoutTrailingSlash } from '@solvapay/mcp-core'

const NATIVE_CLIENT_ORIGIN_REGEX = /^(cursor|vscode|vscode-webview|claude):\/\/.+$/

/** Returns `true` when `origin` is a native MCP-client scheme we mirror. */
export function isNativeClientOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false
  return NATIVE_CLIENT_ORIGIN_REGEX.test(origin)
}

/** Adds CORS mirror headers to `headers` when the request origin is a native client scheme. */
export function applyNativeCors(reqHeaders: Headers, resHeaders: Headers): void {
  const origin = reqHeaders.get('origin')
  if (!origin) return
  if (isNativeClientOrigin(origin)) {
    resHeaders.set('Access-Control-Allow-Origin', origin)
    resHeaders.append('Vary', 'Origin')
  }
}

/** 204 preflight response with CORS mirror for native-scheme origins. */
export function corsPreflight(req: Request): Response {
  const reqHeaders = req.headers
  const requestedMethod = reqHeaders.get('access-control-request-method') ?? 'POST'
  const requestedHeaders =
    reqHeaders.get('access-control-request-headers') ?? 'authorization, content-type'

  const headers = new Headers()
  applyNativeCors(reqHeaders, headers)
  headers.set('Access-Control-Allow-Methods', `${requestedMethod}, OPTIONS`)
  headers.set('Access-Control-Allow-Headers', requestedHeaders)
  headers.set('Access-Control-Max-Age', '600')

  return new Response(null, { status: 204, headers })
}

/**
 * Produce a 401 JSON-RPC response + `WWW-Authenticate: Bearer
 * resource_metadata="…"` pointing at the protected-resource discovery
 * endpoint so MCP clients know where to discover the authorization
 * server.
 */
export function authChallenge(
  req: Request,
  options: {
    publicBaseUrl: string
    protectedResourcePath?: string
    jsonRpcId?: string | number | null
  },
): Response {
  const {
    publicBaseUrl,
    protectedResourcePath = '/.well-known/oauth-protected-resource',
    jsonRpcId = null,
  } = options

  const headers = new Headers()
  applyNativeCors(req.headers, headers)
  headers.set('Access-Control-Expose-Headers', 'WWW-Authenticate')
  headers.set(
    'WWW-Authenticate',
    `Bearer resource_metadata="${withoutTrailingSlash(publicBaseUrl)}${protectedResourcePath}"`,
  )
  headers.set('Content-Type', 'application/json')

  const body = {
    jsonrpc: '2.0',
    id: jsonRpcId,
    error: { code: -32001, message: 'Unauthorized' },
  }
  return new Response(JSON.stringify(body), { status: 401, headers })
}

/** Extract the raw bearer token from an `Authorization: Bearer <token>` header, or `null`. */
export function resolveBearer(req: Request): string | null {
  const header = req.headers.get('authorization')
  if (!header) return null
  const match = /^\s*Bearer\s+(.+?)\s*$/i.exec(header)
  return match ? match[1] : null
}
