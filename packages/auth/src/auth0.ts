/**
 * Auth0 integrations for `@solvapay/auth`:
 *
 * - {@link createAuth0AuthAdapter} — server-side session adapter for Next.js
 *   App Router (v4 `@auth0/nextjs-auth0`). Structural typing, no hard
 *   dependency on Auth0 packages.
 * - {@link createAuth0BearerVerifier} — bearer verifier for an MCP that uses
 *   Auth0 as its authorization server (the `verifyToken` hook of
 *   `@solvapay/mcp/fetch`).
 */

import type { AuthAdapter, AuthRequestHandleResult, ServerIdentity } from './adapter'
import { createJwksBearerVerifier, type BearerTokenVerifier } from './jwks-bearer'

/** Minimal Auth0 client surface used by the adapter. */
export interface Auth0ClientLike {
  middleware(request: Request): Promise<Response>
  getSession(request: Request): Promise<Auth0Session | null>
}

export type Auth0Session = {
  user?: {
    sub?: string
  }
  tokenSet?: {
    idToken?: string
  }
}

export interface Auth0AuthAdapterConfig {
  auth0: Auth0ClientLike
  /** Route prefix owned by Auth0 (default `/auth`). */
  authRoutePrefix?: string
}

function readPathname(req: Request): string {
  return new URL(req.url).pathname
}

function mergeSetCookies(target: Response, source: Response): void {
  for (const cookie of source.headers.getSetCookie()) {
    target.headers.append('set-cookie', cookie)
  }
}

/**
 * Create a server `AuthAdapter` for Auth0 v4 Next.js SDK.
 *
 * Runs Auth0 middleware on every request (session refresh), short-circuits
 * `/auth/*` routes, and forwards `sub` + optional ID token to downstream handlers.
 */
export function createAuth0AuthAdapter(config: Auth0AuthAdapterConfig): AuthAdapter {
  const { auth0, authRoutePrefix = '/auth' } = config

  const resolveIdentity = async (req: Request): Promise<ServerIdentity | null> => {
    const session = await auth0.getSession(req)
    const userId = session?.user?.sub
    if (!userId) {
      return null
    }

    const idToken = session.tokenSet?.idToken
    if (idToken) {
      return { userId, claimsToken: idToken }
    }

    return { userId }
  }

  return {
    async handleRequest(req: Request): Promise<AuthRequestHandleResult | null> {
      const sessionResponse = await auth0.middleware(req)
      const pathname = readPathname(req)

      if (pathname.startsWith(authRoutePrefix)) {
        return { response: sessionResponse, ownsRequest: true }
      }

      return { sessionResponse, ownsRequest: false }
    },

    async getIdentityFromRequest(req: Request): Promise<ServerIdentity | null> {
      return resolveIdentity(req)
    },

    async getUserIdFromRequest(req: Request): Promise<string | null> {
      const identity = await resolveIdentity(req)
      return identity?.userId ?? null
    },
  }
}

/** @internal exported for middleware cookie merge helper tests */
export { mergeSetCookies }

export interface Auth0BearerVerifierOptions {
  /**
   * The **token-issuing** Auth0 domain, as a bare hostname.
   *
   * Use the custom domain when the tenant has one configured
   * (`auth.example.com`), otherwise the canonical tenant domain
   * (`tenant.eu.auth0.com`). Auth0 stamps `iss` with whichever hostname the
   * authorize/token request went through and serves the JWKS on both, so
   * this value, the handler's `authorizationServer.issuers[0]` and the
   * authorization server MCP clients discover must all be the same
   * hostname. A token issued through the canonical domain is rejected by a
   * verifier configured with the custom domain, by design.
   */
  domain: string
  /**
   * The Auth0 API identifier, which must equal the canonical MCP URL
   * (`${publicBaseUrl}${mcpPath}`, no trailing slash) byte-for-byte.
   */
  audience: string
  /**
   * Prefix of the custom claims a post-login Action adds to the access token
   * (`${claimNamespace}email`, `${claimNamespace}email_verified`,
   * `${claimNamespace}name`). Defaults to `https://solvapay.com/`.
   */
  claimNamespace?: string
}

export const AUTH0_DEFAULT_CLAIM_NAMESPACE = 'https://solvapay.com/'

const BARE_HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i

function assertAuth0Domain(domain: string): void {
  if (typeof domain !== 'string' || !BARE_HOSTNAME.test(domain)) {
    throw new Error(
      `[solvapay/auth] createAuth0BearerVerifier: \`domain\` must be a bare hostname such as "tenant.eu.auth0.com" or "auth.example.com" (no scheme, path or trailing slash). Received "${String(domain)}".`,
    )
  }
}

/**
 * Bearer verifier for an MCP whose authorization server is Auth0.
 *
 * Wraps {@link createJwksBearerVerifier} with Auth0's shape: issuer
 * `https://{domain}/` (Auth0 always ends `iss` with a slash), JWKS at
 * `https://{domain}/.well-known/jwks.json`, and the profile read from
 * namespaced access-token claims set by a post-login Action:
 *
 * ```js
 * exports.onExecutePostLogin = async (event, api) => {
 *   const ns = 'https://solvapay.com/'
 *   api.accessToken.setCustomClaim(`${ns}email`, event.user.email)
 *   api.accessToken.setCustomClaim(`${ns}email_verified`, event.user.email_verified)
 *   api.accessToken.setCustomClaim(`${ns}name`, event.user.name)
 * }
 * ```
 *
 * Prefer the Action over `/userinfo`: it is Auth0's documented pattern for
 * API access tokens and avoids the per-user userinfo rate limit. A tenant
 * without the Action can use the generic verifier with
 * `userinfoEndpoint: 'https://{domain}/userinfo'` instead.
 *
 * @example
 * ```ts
 * import { createAuth0BearerVerifier } from '@solvapay/auth/auth0'
 * import { createSolvaPayMcpFetch } from '@solvapay/mcp/fetch'
 *
 * const domain = 'auth.example.com'
 * export default createSolvaPayMcpFetch({
 *   // …
 *   verifyToken: createAuth0BearerVerifier({ domain, audience: 'https://mcp.example.com/mcp' }),
 *   authorizationServer: {
 *     issuers: [`https://${domain}/`],
 *     scopesSupported: ['openid', 'profile', 'email', 'offline_access'],
 *   },
 * })
 * ```
 */
export function createAuth0BearerVerifier(
  options: Auth0BearerVerifierOptions,
): BearerTokenVerifier {
  const { domain, audience, claimNamespace = AUTH0_DEFAULT_CLAIM_NAMESPACE } = options
  assertAuth0Domain(domain)
  return createJwksBearerVerifier({
    issuer: `https://${domain}/`,
    audience,
    jwksUri: `https://${domain}/.well-known/jwks.json`,
    claims: {
      email: `${claimNamespace}email`,
      emailVerified: `${claimNamespace}email_verified`,
      name: `${claimNamespace}name`,
    },
  })
}
