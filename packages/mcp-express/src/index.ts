/**
 * `@solvapay/mcp-express` — Node `(req, res, next)` OAuth bridge
 * middleware for the SolvaPay MCP server.
 *
 * Pair with `@solvapay/mcp` (MCP server factory) and
 * `@solvapay/mcp-core` (framework-neutral contracts). For
 * Web-standards runtimes (Deno / Supabase Edge / Cloudflare Workers /
 * Bun / Next edge / Vercel Functions) use `@solvapay/mcp-fetch`
 * instead.
 *
 * @example
 * ```ts
 * import express from 'express'
 * import { createMcpOAuthBridge } from '@solvapay/mcp-express'
 *
 * const app = express()
 * app.use(express.json())
 * app.use(express.urlencoded({ extended: false }))
 * app.use(...createMcpOAuthBridge({
 *   publicBaseUrl: 'https://my-mcp.example.com',
 *   apiBaseUrl: 'https://api.solvapay.com',
 *   productRef: 'prd_video',
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
  McpBearerCustomerRefOptions,
  OAuthAuthorizationServerOptions,
  OAuthBridgePaths,
} from '@solvapay/mcp-core'
