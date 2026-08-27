/**
 * Framework-neutral OAuth discovery JSON builders. These are runtime-agnostic
 * (no Node, no fetch, no Express) — both `@solvapay/mcp/express` and
 * `@solvapay/mcp/fetch` import them to produce the well-known responses.
 *
 * Document bodies and path helpers come from the Rust `mcpOauthDiscovery` /
 * `mcpOauthPath` ops.
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
  return callMcpSyncOp('mcpOauthPath', { kind: 'strip-trailing-slash', value })
}

export function resolveOAuthPaths(paths: OAuthBridgePaths = {}): Required<OAuthBridgePaths> {
  return callMcpSyncOp('mcpOauthPath', { kind: 'resolve-paths', paths })
}

export function withLeadingSlash(value: string): string {
  return callMcpSyncOp('mcpOauthPath', { kind: 'leading-slash', value })
}

export function mcpResourceIdentifier(publicBaseUrl: string, mcpPath?: string): string {
  return callMcpSyncOp('mcpOauthPath', {
    kind: 'resource-identifier',
    publicBaseUrl,
    ...(mcpPath !== undefined ? { mcpPath } : {}),
  })
}

/** RFC 9728 path-aware protected-resource metadata URL for an MCP mount. */
export function pathAwareProtectedResourcePath(mcpPath: string): string {
  return callMcpSyncOp('mcpOauthPath', {
    kind: 'protected-resource-path',
    mcpPath,
  })
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
