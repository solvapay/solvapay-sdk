/**
 * `@solvapay/mcp/express` — Node `(req, res, next)` OAuth bridge
 * middleware for the SolvaPay MCP server, plus a turnkey factory that
 * wraps `createSolvaPayMcpFetch` (JSON `mcpDispatch` loop by default).
 *
 * Pair with `@solvapay/mcp` (root entry — MCP server factory +
 * `registerPayableTool`) and `@solvapay/mcp-core` (framework-neutral
 * contracts). For Web-standards runtimes (Deno / Supabase Edge /
 * Cloudflare Workers / Bun / Next edge / Vercel Functions) use
 * `@solvapay/mcp/fetch` instead.
 *
 * @example
 * ```ts
 * import express from 'express'
 * import { createSolvaPayMcpExpress } from '@solvapay/mcp/express'
 *
 * const app = express()
 * app.use(express.json())
 * app.use(createSolvaPayMcpExpress({
 *   solvaPay,
 *   productRef,
 *   publicBaseUrl,
 *   apiBaseUrl,
 * }))
 * ```
 */

export {
  createMcpOAuthBridge,
  createOAuthAuthorizeHandler,
  createOAuthRegisterHandler,
  createOAuthRevokeHandler,
  createOAuthTokenHandler,
} from './oauth-bridge'
export type {
  McpOAuthBridgeOptions,
  OAuthAuthorizeHandlerOptions,
  OAuthRegisterHandlerOptions,
  OAuthRevokeHandlerOptions,
  OAuthTokenHandlerOptions,
} from './oauth-bridge'

// Re-export from @solvapay/mcp-core for convenience so merchants can
// type `authInfo` / discovery responses without a second install.
export {
  getOAuthAuthorizationServerResponse,
  getOAuthProtectedResourceResponse,
  buildAuthInfoFromBearer,
  McpBearerAuthError,
  decodeJwtPayload,
  extractBearerToken,
  getCustomerRefFromBearerAuthHeader,
  getCustomerRefFromJwtPayload,
} from '@solvapay/mcp-core'
export type {
  BuildAuthInfoFromBearerOptions,
  McpAuthMode,
  McpBearerCustomerRefOptions,
  OAuthAuthorizationServerOptions,
  OAuthBridgePaths,
} from '@solvapay/mcp-core'

import {
  createSolvaPayMcpFetch,
  type CreateSolvaPayMcpFetchOptions,
} from '../fetch/createSolvaPayMcpFetch'

type ExpressRequest = {
  method?: string
  url?: string
  originalUrl?: string
  protocol?: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
  get?: (name: string) => string | undefined
}

type ExpressResponse = {
  status: (code: number) => ExpressResponse
  setHeader: (name: string, value: string) => void
  end: (chunk?: string | Buffer) => void
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()]
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return undefined
}

export function createSolvaPayMcpExpress(
  options: CreateSolvaPayMcpFetchOptions,
): (req: ExpressRequest, res: ExpressResponse, next?: (err?: unknown) => void) => void {
  const fetchHandler = createSolvaPayMcpFetch({
    ...options,
    responseMode: options.responseMode ?? 'json',
  })
  return (req, res, next): void => {
    void (async () => {
      try {
        const host = req.get?.('host') ?? headerValue(req.headers, 'host') ?? 'localhost'
        const proto = req.protocol ?? 'http'
        const path = req.originalUrl ?? req.url ?? '/'
        const headers = new Headers()
        for (const [key, value] of Object.entries(req.headers)) {
          if (typeof value === 'string') headers.set(key, value)
          else if (Array.isArray(value)) headers.set(key, value.join(', '))
        }
        const method = req.method ?? 'GET'
        const hasBody = method !== 'GET' && method !== 'HEAD'
        let body: BodyInit | undefined
        if (hasBody) {
          if (typeof req.body === 'string') {
            body = req.body
          } else if (req.body instanceof Uint8Array) {
            // Copy so the type is `Uint8Array<ArrayBuffer>` (BodyInit), not ArrayBufferLike.
            const bytes = new Uint8Array(req.body.byteLength)
            bytes.set(req.body)
            body = bytes
          } else if (req.body !== undefined) {
            body = JSON.stringify(req.body)
            if (!headers.has('content-type')) headers.set('content-type', 'application/json')
          }
        }
        const request = new Request(`${proto}://${host}${path}`, { method, headers, body })
        const response = await fetchHandler(request)
        res.status(response.status)
        response.headers.forEach((value, key) => {
          res.setHeader(key, value)
        })
        res.end(Buffer.from(await response.arrayBuffer()))
      } catch (error) {
        if (next) next(error)
        else throw error
      }
    })()
  }
}
