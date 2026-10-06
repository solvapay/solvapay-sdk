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

/**
 * Overrides for the RFC 9728 protected-resource metadata. Every field
 * defaults to the SolvaPay-as-authorization-server shape, so callers that
 * pass nothing get today's output byte-for-byte.
 */
export interface OAuthProtectedResourceOptions {
  /**
   * Issuer URLs of the authorization servers that mint this resource's
   * tokens. Emitted verbatim: an issuer that ends in `/` (Auth0) or carries
   * a path component (Supabase) must be passed exactly as the client will
   * discover it.
   */
  authorizationServers?: string[]
  scopesSupported?: string[]
  /** Canonical resource identifier. Defaults to `publicBaseUrl` without a trailing slash. */
  resource?: string
}

export const DEFAULT_OAUTH_SCOPES_SUPPORTED: readonly string[] = ['openid', 'profile', 'email']

export function getOAuthProtectedResourceResponse(
  publicBaseUrl: string,
  options: OAuthProtectedResourceOptions = {},
) {
  const base = withoutTrailingSlash(publicBaseUrl)
  return {
    resource: options.resource ?? base,
    authorization_servers: options.authorizationServers ?? [base],
    scopes_supported: options.scopesSupported ?? [...DEFAULT_OAUTH_SCOPES_SUPPORTED],
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
    scopes_supported: [...DEFAULT_OAUTH_SCOPES_SUPPORTED],
    code_challenge_methods_supported: ['S256'],
  }
}
