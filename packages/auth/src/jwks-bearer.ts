/**
 * Generic JWKS bearer verifier for any OIDC issuer (Auth0, Clerk,
 * Supabase, WorkOS, Okta, Keycloak, …) that signs RS256 / ES256 access
 * tokens and publishes a JWKS.
 *
 * Built for the `verifyToken` seam of `@solvapay/mcp/fetch`, where the
 * contract is: `null` means "token rejected, answer 401"; a thrown error
 * means "this is not the client's fault, answer 500 and never hide it".
 *
 * Provider presets (`createAuth0BearerVerifier`, …) are thin wrappers that
 * translate a dashboard's vocabulary into these options and encode the one
 * or two quirks the generic layer must not guess at. Any issuer without
 * such a quirk should call `createJwksBearerVerifier` directly.
 *
 * `jose` is a peer dependency, imported lazily on first use (repo
 * convention) so the entry stays Edge-safe and dependency-free when unused.
 */

import type { JWTPayload } from 'jose'

/**
 * Result of a successful verification. Structurally identical to
 * `VerifiedBearer` in `@solvapay/mcp-core` (kept separate so this package
 * has no dependency on it).
 */
export interface VerifiedBearer {
  /** The issuer's stable user identifier (`sub`). */
  subject: string
  /** Set by the SolvaPay bridge, never by this verifier. */
  customerRef?: string
  email?: string
  emailVerified?: boolean
  name?: string
  clientId?: string
  scopes?: string[]
  /** Unix seconds. */
  expiresAt?: number
  /** The audience the token was verified against. */
  resource?: string
  /** The verified claims set. */
  claims?: Record<string, unknown>
}

export type BearerTokenVerifier = (token: string, req: Request) => Promise<VerifiedBearer | null>

/** Access-token claim names the profile is read from. */
export interface BearerProfileClaims {
  /** Claim carrying the user's email. Required: without it the bridge cannot link identities. */
  email: string
  /** Claim carrying a boolean `email_verified`. Strongly recommended; without it `email` is never trusted. */
  emailVerified?: string
  name?: string
}

export interface JwksBearerVerifierOptions {
  /**
   * Exact `iss` value, compared verbatim. The verifier never appends or
   * strips a trailing slash or a path: Auth0 issues `https://tenant/`,
   * Supabase issues `https://ref.supabase.co/auth/v1`. This string must be
   * byte-for-byte what the handler advertises in PRM `authorization_servers`.
   */
  issuer: string
  /** Required `aud`: the canonical MCP URL (`${publicBaseUrl}${mcpPath}`). Never relaxed. */
  audience: string
  /** Defaults to `${issuer}/.well-known/jwks.json` (joined with exactly one slash). */
  jwksUri?: string
  /** Read the profile from access-token claims. Mutually exclusive with `userinfoEndpoint`. */
  claims?: BearerProfileClaims
  /**
   * Read the profile from the issuer's OIDC userinfo endpoint (`email`,
   * `email_verified`, `name`). One call per token, memoised until `exp`.
   * Mutually exclusive with `claims`.
   */
  userinfoEndpoint?: string
  /**
   * Consulted only when the signature, issuer and expiry verified but `aud`
   * did not, with the (authentic) payload. Return a message to turn the
   * failure into a thrown configuration error ("the issuer is not stamping
   * the MCP audience; here is the fix"), or `undefined` to keep the 401.
   */
  audienceMismatchHint?: (payload: JWTPayload) => string | undefined
}

type Jose = typeof import('jose')
type RemoteJwks = ReturnType<Jose['createRemoteJWKSet']>

interface Profile {
  email?: string
  emailVerified?: boolean
  name?: string
}

const USERINFO_CACHE_MAX = 1000

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

/** `https://` only; `http://` is accepted on a loopback host for local stacks. */
function assertHttpsOrLoopback(value: string, label: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`[solvapay/auth] ${label} "${value}" is not an absolute URL.`)
  }
  if (url.protocol === 'https:') return
  if (url.protocol === 'http:' && isLoopbackHost(url.hostname)) return
  throw new Error(
    `[solvapay/auth] ${label} "${value}" must use https:// (http:// is allowed only for localhost / 127.0.0.1).`,
  )
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function validateOptions(options: JwksBearerVerifierOptions): void {
  if (!options.issuer) {
    throw new Error('[solvapay/auth] createJwksBearerVerifier requires `issuer`.')
  }
  if (!options.audience) {
    throw new Error(
      '[solvapay/auth] createJwksBearerVerifier requires `audience`: the canonical MCP URL the tokens are bound to (`${publicBaseUrl}${mcpPath}`).',
    )
  }
  assertHttpsOrLoopback(options.issuer, 'issuer')
  if (options.jwksUri !== undefined) assertHttpsOrLoopback(options.jwksUri, 'jwksUri')
  if (options.userinfoEndpoint !== undefined) {
    assertHttpsOrLoopback(options.userinfoEndpoint, 'userinfoEndpoint')
  }

  const hasClaims = options.claims !== undefined
  const hasUserinfo = options.userinfoEndpoint !== undefined
  if (hasClaims && hasUserinfo) {
    throw new Error(
      '[solvapay/auth] createJwksBearerVerifier: pass either `claims` or `userinfoEndpoint`, not both. The profile has exactly one source.',
    )
  }
  if (!hasClaims && !hasUserinfo) {
    throw new Error(
      '[solvapay/auth] createJwksBearerVerifier needs a profile source: `claims` (access-token claim names) or `userinfoEndpoint` (OIDC userinfo URL). Without email + email_verified the bridge would create a fresh customer for every user instead of linking existing ones.',
    )
  }
  if (hasClaims && !options.claims?.email) {
    throw new Error(
      '[solvapay/auth] createJwksBearerVerifier: `claims.email` is required (the access-token claim carrying the user email, e.g. "https://solvapay.com/email").',
    )
  }
}

function readString(payload: Record<string, unknown>, key: string | undefined): string | undefined {
  if (!key) return undefined
  const value = payload[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function readBoolean(
  payload: Record<string, unknown>,
  key: string | undefined,
): boolean | undefined {
  if (!key) return undefined
  const value = payload[key]
  return typeof value === 'boolean' ? value : undefined
}

function profileFromClaims(payload: JWTPayload, claims: BearerProfileClaims): Profile {
  return {
    email: readString(payload, claims.email),
    emailVerified: readBoolean(payload, claims.emailVerified),
    name: readString(payload, claims.name),
  }
}

function readClientId(payload: JWTPayload): string | undefined {
  return readString(payload, 'client_id') ?? readString(payload, 'azp')
}

function readScopes(payload: JWTPayload): string[] | undefined {
  if (Array.isArray(payload.scp)) {
    return payload.scp.filter((scope): scope is string => typeof scope === 'string')
  }
  const scope = readString(payload, 'scope')
  return scope ? scope.split(/\s+/).filter(Boolean) : undefined
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function userinfoFailureHint(status: number): string {
  if (status === 401 || status === 403) {
    return 'The token is not accepted by userinfo, usually because it was issued without the `openid`, `profile` and `email` scopes. Add them to the handler\u2019s `authorizationServer.scopesSupported` and to the issuer\u2019s default scopes for dynamically registered clients.'
  }
  return 'Check that `userinfoEndpoint` is the issuer\u2019s OIDC userinfo URL and that the issuer is reachable from this runtime.'
}

/**
 * Verify a bearer token against an OIDC issuer's JWKS and return the
 * verified subject and profile, or `null` when the token is rejected.
 *
 * - Signature, `iss` (verbatim) and `aud` are always checked. The signing
 *   algorithm is whatever the JWKS key says (RS256, ES256, …); nothing is pinned.
 * - A verified token without a non-empty string `sub` is rejected (`null`).
 * - Rejections (`null`): expired, bad signature, wrong issuer/audience,
 *   malformed, no matching key. Everything else throws: JWKS unreachable or
 *   timed out, userinfo non-2xx, or an `audienceMismatchHint` message.
 *
 * @example Any OIDC issuer, profile from userinfo
 * ```ts
 * const verifyToken = createJwksBearerVerifier({
 *   issuer: 'https://auth.example.com',
 *   audience: 'https://mcp.example.com/mcp',
 *   userinfoEndpoint: 'https://auth.example.com/userinfo',
 * })
 * ```
 */
export function createJwksBearerVerifier(options: JwksBearerVerifierOptions): BearerTokenVerifier {
  validateOptions(options)
  const { issuer, audience, claims, userinfoEndpoint, audienceMismatchHint } = options
  const jwksUri = options.jwksUri ?? joinUrl(issuer, '/.well-known/jwks.json')

  let josePromise: Promise<Jose> | undefined
  const loadJose = (): Promise<Jose> => (josePromise ??= import('jose'))

  let jwks: RemoteJwks | undefined
  const userinfoCache = new Map<string, { expiresAt: number; profile: Profile }>()

  const verifyJwt = async (
    jose: Jose,
    token: string,
  ): Promise<{ payload: JWTPayload } | { rejected: true }> => {
    jwks ??= jose.createRemoteJWKSet(new URL(jwksUri))
    try {
      const { payload } = await jose.jwtVerify(token, jwks, { issuer, audience })
      return { payload }
    } catch (error) {
      const { errors } = jose
      if (error instanceof errors.JWTClaimValidationFailed && error.claim === 'aud') {
        // Signature and issuer already verified; jose checks `exp` after `aud`,
        // so do it here before trusting the payload for the hint.
        const exp = error.payload.exp
        const expired = typeof exp === 'number' && exp <= nowSeconds()
        const hint =
          !expired && audienceMismatchHint ? audienceMismatchHint(error.payload) : undefined
        if (hint) throw new Error(`[solvapay/auth] ${hint}`)
        return { rejected: true }
      }
      if (
        error instanceof errors.JWTExpired ||
        error instanceof errors.JWTClaimValidationFailed ||
        error instanceof errors.JWSSignatureVerificationFailed ||
        error instanceof errors.JWSInvalid ||
        error instanceof errors.JWTInvalid ||
        error instanceof errors.JWKSNoMatchingKey
      ) {
        return { rejected: true }
      }
      throw error
    }
  }

  const fetchUserinfo = async (token: string, exp: number | undefined): Promise<Profile> => {
    if (!userinfoEndpoint) throw new Error('[solvapay/auth] userinfoEndpoint is not configured')
    const key = await sha256Hex(token)
    const now = nowSeconds()
    const cached = userinfoCache.get(key)
    if (cached && cached.expiresAt > now) return cached.profile

    const response = await fetch(userinfoEndpoint, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    })
    if (!response.ok) {
      throw new Error(
        `[solvapay/auth] userinfo request to ${userinfoEndpoint} failed with HTTP ${response.status}. ${userinfoFailureHint(response.status)}`,
      )
    }
    const body: unknown = await response.json()
    if (typeof body !== 'object' || body === null) {
      throw new Error(
        `[solvapay/auth] userinfo request to ${userinfoEndpoint} returned a non-object body.`,
      )
    }
    const record = body as Record<string, unknown>
    const profile: Profile = {
      email: readString(record, 'email'),
      emailVerified: readBoolean(record, 'email_verified'),
      name: readString(record, 'name'),
    }

    for (const [cachedKey, entry] of userinfoCache) {
      if (entry.expiresAt <= now) userinfoCache.delete(cachedKey)
    }
    if (userinfoCache.size >= USERINFO_CACHE_MAX) {
      const oldest = userinfoCache.keys().next()
      if (!oldest.done) userinfoCache.delete(oldest.value)
    }
    userinfoCache.set(key, { expiresAt: exp ?? now, profile })
    return profile
  }

  return async (token: string): Promise<VerifiedBearer | null> => {
    const jose = await loadJose()
    const outcome = await verifyJwt(jose, token)
    if ('rejected' in outcome) return null

    const { payload } = outcome
    const subject = payload.sub
    if (typeof subject !== 'string' || subject.length === 0) return null

    const profile = claims
      ? profileFromClaims(payload, claims)
      : await fetchUserinfo(token, payload.exp)

    return withoutUndefined({
      subject,
      email: profile.email,
      emailVerified: profile.emailVerified,
      name: profile.name,
      clientId: readClientId(payload),
      scopes: readScopes(payload),
      expiresAt: payload.exp,
      resource: audience,
      claims: payload,
    })
  }
}

function withoutUndefined(bearer: VerifiedBearer): VerifiedBearer {
  return Object.fromEntries(
    Object.entries(bearer).filter(([, value]) => value !== undefined),
  ) as VerifiedBearer // every key came from a VerifiedBearer; only `undefined` values were dropped
}
