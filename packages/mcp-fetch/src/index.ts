/**
 * `@solvapay/mcp-fetch` — fetch-first OAuth bridge + turnkey MCP
 * handler for Web-standards runtimes (Deno / Supabase Edge /
 * Cloudflare Workers / Bun / Next edge / Vercel Functions). Parallel
 * adapter to `@solvapay/mcp` (Node `McpServer` wiring) and
 * `@solvapay/mcp-express` (`(req, res, next)` middleware) — edge
 * consumers should import ONLY from this package.
 *
 * @example Unified factory (recommended for edge runtimes):
 *
 * ```ts
 * import { createSolvaPayMcpFetch } from '@solvapay/mcp-fetch'
 *
 * Deno.serve(
 *   createSolvaPayMcpFetch({
 *     solvaPay,
 *     productRef,
 *     resourceUri: 'ui://my-app/mcp-app.html',
 *     readHtml: () => Deno.readTextFile('./mcp-app.html'),
 *     publicBaseUrl,
 *     apiBaseUrl,
 *     mode: 'json-stateless',
 *     hideToolsByAudience: ['ui'],
 *   }),
 * )
 * ```
 *
 * @example BYO-server (Node / Express / Bun):
 *
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
export type { CreateSolvaPayMcpFetchHandlerOptions, McpHandlerMode } from './handler'

export { createSolvaPayMcpFetch } from './createSolvaPayMcpFetch'
export type {
  AdditionalToolsContext,
  CreateSolvaPayMcpFetchOptions,
} from './createSolvaPayMcpFetch'

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
