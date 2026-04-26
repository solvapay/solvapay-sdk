/**
 * Framework-neutral OAuth discovery JSON builders. These are runtime-agnostic
 * (no Node, no fetch, no Express) — both `@solvapay/mcp/express` and
 * `@solvapay/mcp/fetch` import them to produce the well-known responses.
 *
 * Kept in `@solvapay/mcp-core` so third-party adapter authors (raw JSON-RPC,
 * `fastmcp`, …) can reuse the exact same shapes with zero transitive deps.
 */

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

export function getOAuthProtectedResourceResponse(publicBaseUrl: string) {
  const resource = withoutTrailingSlash(publicBaseUrl)
  return {
    resource,
    authorization_servers: [resource],
    scopes_supported: ['openid', 'profile', 'email'],
  }
}

export function getOAuthAuthorizationServerResponse({
  publicBaseUrl,
  paths,
}: OAuthAuthorizationServerOptions) {
  const base = withoutTrailingSlash(publicBaseUrl)
  const p = resolveOAuthPaths(paths)
  return {
    issuer: base,
    authorization_endpoint: `${base}${p.authorize}`,
    token_endpoint: `${base}${p.token}`,
    registration_endpoint: `${base}${p.register}`,
    revocation_endpoint: `${base}${p.revoke}`,
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    scopes_supported: ['openid', 'profile', 'email'],
    code_challenge_methods_supported: ['S256'],
  }
}
