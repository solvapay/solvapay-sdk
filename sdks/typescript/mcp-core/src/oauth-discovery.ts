/**
 * Framework-neutral OAuth discovery JSON builders. These are runtime-agnostic
 * (no Node, no fetch, no Express) — both `@solvapay/mcp/express` and
 * `@solvapay/mcp/fetch` import them to produce the well-known responses.
 *
 * Document bodies come from the Rust `mcpOauthDiscovery` op. Path helpers
 * stay here because adapters use them for HTTP routing.
 */

import { callMcpSyncOp } from './native-mcp'

export interface OAuthBridgePaths {
  register?: string
  authorize?: string
  token?: string
  revoke?: string
}

export interface OAuthAuthorizationServerOptions {
  publicBaseUrl: string
  paths?: OAuthBridgePaths
}

export const DEFAULT_OAUTH_PATHS: Required<OAuthBridgePaths> = {
  register: '/oauth/register',
  authorize: '/oauth/authorize',
  token: '/oauth/token',
  revoke: '/oauth/revoke',
}

export function withoutTrailingSlash(value: string): string {
  return value.replace(/\/$/, '')
}

export function resolveOAuthPaths(paths: OAuthBridgePaths = {}): Required<OAuthBridgePaths> {
  return { ...DEFAULT_OAUTH_PATHS, ...paths }
}

export function withLeadingSlash(value: string): string {
  return value.startsWith('/') ? value : `/${value}`
}

export function mcpResourceIdentifier(publicBaseUrl: string, mcpPath?: string): string {
  const origin = withoutTrailingSlash(publicBaseUrl)
  if (!mcpPath) return origin
  const path = withoutTrailingSlash(withLeadingSlash(mcpPath))
  return path ? `${origin}${path}` : origin
}

/** RFC 9728 path-aware protected-resource metadata URL for an MCP mount. */
export function pathAwareProtectedResourcePath(mcpPath: string): string {
  const path = withoutTrailingSlash(withLeadingSlash(mcpPath))
  return path && path !== '/'
    ? `/.well-known/oauth-protected-resource${path}`
    : '/.well-known/oauth-protected-resource'
}

export type OAuthProtectedResourceDocument = {
  resource: string
  authorization_servers: string[]
  scopes_supported: string[]
  bearer_methods_supported: string[]
}

export type OAuthAuthorizationServerDocument = {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint: string
  revocation_endpoint: string
  token_endpoint_auth_methods_supported: string[]
  response_types_supported: string[]
  grant_types_supported: string[]
  scopes_supported: string[]
  code_challenge_methods_supported: string[]
}

export function getOAuthProtectedResourceResponse(
  publicBaseUrl: string,
  mcpPath?: string,
): OAuthProtectedResourceDocument {
  return callMcpSyncOp('mcpOauthDiscovery', {
    kind: 'protected-resource',
    publicBaseUrl,
    ...(mcpPath !== undefined ? { mcpPath } : {}),
  })
}

export function getOAuthAuthorizationServerResponse(
  options: OAuthAuthorizationServerOptions,
): OAuthAuthorizationServerDocument {
  return callMcpSyncOp('mcpOauthDiscovery', {
    kind: 'authorization-server',
    publicBaseUrl: options.publicBaseUrl,
    ...(options.paths !== undefined ? { paths: options.paths } : {}),
  })
}
