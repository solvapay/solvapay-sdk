/**
 * `@solvapay/mcp-fetch` — fetch-first OAuth bridge + turnkey MCP
 * handler for Web-standards runtimes (Deno / Supabase Edge /
 * Cloudflare Workers / Bun / Next edge / Vercel Functions).
 *
 * For Node `(req, res, next)` middleware see
 * [`@solvapay/mcp-express`](../mcp-express).
 *
 * @example
 * ```ts
 * import { createSolvaPayMcpServer } from '@solvapay/mcp'
 * import { createSolvaPayMcpFetchHandler } from '@solvapay/mcp-fetch'
 *
 * const server = createSolvaPayMcpServer({ …descriptorOptions })
 * Deno.serve(
 *   createSolvaPayMcpFetchHandler({
 *     server,
 *     publicBaseUrl,
 *     apiBaseUrl,
 *     productRef,
 *   }),
 * )
 * ```
 */

export {
  createAuthorizationServerHandler,
  createOAuthAuthorizeHandler,
  createOAuthFetchRouter,
  createOAuthRegisterHandler,
  createOAuthRevokeHandler,
  createOAuthTokenHandler,
  createOpenidNotFoundHandler,
  createProtectedResourceHandler,
} from './oauth-bridge'
export type { FetchOAuthOptions } from './oauth-bridge'

export {
  applyNativeCors,
  authChallenge,
  corsPreflight,
  isNativeClientOrigin,
  resolveBearer,
} from './cors'

export { createSolvaPayMcpFetchHandler } from './handler'
export type { CreateSolvaPayMcpFetchHandlerOptions } from './handler'

// Convenience re-exports from @solvapay/mcp-core.
export {
  getOAuthAuthorizationServerResponse,
  getOAuthProtectedResourceResponse,
  buildAuthInfoFromBearer,
  McpBearerAuthError,
} from '@solvapay/mcp-core'
export type {
  BuildAuthInfoFromBearerOptions,
  OAuthAuthorizationServerOptions,
  OAuthBridgePaths,
} from '@solvapay/mcp-core'
