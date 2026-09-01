/**
 * Native-scheme CORS preflight + 401 `WWW-Authenticate` helpers for MCP
 * clients on Web-standards runtimes.
 *
 * Allowlist and challenge bodies come from the Rust `mcpNativeCors` /
 * `mcpAuthGate` ops. Facades only merge headers onto `Response`.
 */

import { mcpAuthGate, mcpNativeCors, isNativeClientOrigin } from '@solvapay/mcp-core'

export { isNativeClientOrigin }

function applyCorsResult(resHeaders: Headers, headers: Record<string, string>): void {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'vary') {
      resHeaders.append('Vary', value)
      continue
    }
    resHeaders.set(key, value)
  }
}

/** Adds CORS mirror headers to `headers` when the request origin is a native client scheme. */
export function applyNativeCors(reqHeaders: Headers, resHeaders: Headers): void {
  const { headers } = mcpNativeCors({ origin: reqHeaders.get('origin') })
  applyCorsResult(resHeaders, headers)
}

/** 204 preflight response with CORS mirror for native-scheme origins. */
export function corsPreflight(req: Request): Response {
  const reqHeaders = req.headers
  const { headers } = mcpNativeCors({
    origin: reqHeaders.get('origin'),
    requestedMethod: reqHeaders.get('access-control-request-method'),
    requestedHeaders: reqHeaders.get('access-control-request-headers'),
    preflight: true,
  })
  const out = new Headers()
  applyCorsResult(out, headers)
  return new Response(null, { status: 204, headers: out })
}

/**
 * Produce a 401 JSON-RPC response + `WWW-Authenticate` from `mcpAuthGate`,
 * with native-scheme CORS layered on top.
 */
export function authChallenge(
  req: Request,
  options: {
    publicBaseUrl: string
    mcpPath?: string
    protectedResourcePath?: string
    jsonRpcId?: string | number | null
  },
): Response {
  const { publicBaseUrl, mcpPath, protectedResourcePath, jsonRpcId = null } = options
  const gate = mcpAuthGate({
    publicBaseUrl,
    rpcMethod: 'tools/call',
    jsonRpcId,
    ...(mcpPath !== undefined ? { mcpPath } : {}),
  })
  const headers = new Headers()
  applyNativeCors(req.headers, headers)
  if (gate.kind === 'challenge') {
    for (const [key, value] of Object.entries(gate.headers)) {
      headers.set(key, value)
    }
    if (protectedResourcePath !== undefined) {
      headers.set(
        'WWW-Authenticate',
        `Bearer resource_metadata="${publicBaseUrl.replace(/\/$/, '')}${protectedResourcePath}"`,
      )
    }
    return new Response(JSON.stringify(gate.body), { status: gate.status, headers })
  }
  return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers })
}

/** Extract the raw bearer token from an `Authorization: Bearer <token>` header, or `null`. */
export function resolveBearer(req: Request): string | null {
  const header = req.headers.get('authorization')
  if (!header) return null
  const match = /^\s*Bearer\s+(.+?)\s*$/i.exec(header)
  return match ? match[1] : null
}
