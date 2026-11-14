/**
 * Verifies a bearer token before a route trusts who it names.
 *
 * Every SolvaPay route helper that reads the user from `Authorization: Bearer`
 * goes through `verifyBearerToken`. A token is trusted only when one of these
 * says so, chosen by the token's `alg`:
 *
 * - **HS256** with a shared secret: `jwtSecret`, else `SOLVAPAY_JWT_SECRET`,
 *   else `SUPABASE_JWT_SECRET`.
 * - **ES256 / RS256 and other asymmetric algorithms** against a JWKS:
 *   `jwksUrl`, else `SOLVAPAY_JWKS_URL`, else, on Supabase,
 *   `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`.
 * - **A gateway that already verified it**, only when you say so:
 *   `trustGateway`, or `SOLVAPAY_AUTH_TRUST_GATEWAY=true` (for example
 *   Supabase Edge Functions with `verify_jwt = true`). The token is then read
 *   without checking its signature, so turn this on only when nothing can
 *   reach the handler without passing that gateway.
 *
 * With none of these, the token is refused: there is no unverified default.
 * `SOLVAPAY_AUTH_STRICT=true` forbids gateway trust outright.
 */

import { createRemoteJWKSet, decodeJwt, decodeProtectedHeader, jwtVerify, type JWTPayload } from 'jose'

export type TokenVerification =
  | { ok: true; payload: JWTPayload; verifiedBy: 'secret' | 'jwks' | 'gateway' }
  | { ok: false; reason: string }

export interface VerifyBearerTokenOptions {
  /** HS256 secret; defaults to SOLVAPAY_JWT_SECRET, then SUPABASE_JWT_SECRET. */
  jwtSecret?: string
  /** JWKS URL for ES256/RS256 tokens; defaults to SOLVAPAY_JWKS_URL, then Supabase's from SUPABASE_URL. */
  jwksUrl?: string
  /** Trust a gateway that verified the token already; defaults to SOLVAPAY_AUTH_TRUST_GATEWAY=true. */
  trustGateway?: boolean
}

const ASYMMETRIC_ALGORITHMS = ['ES256', 'ES384', 'ES512', 'RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'EdDSA']

export const TOKEN_NOT_VERIFIABLE =
  'No way to verify the authentication token. Set SOLVAPAY_JWT_SECRET (HS256 tokens), ' +
  'SOLVAPAY_JWKS_URL (ES256/RS256 tokens; derived from SUPABASE_URL on Supabase), or ' +
  'SOLVAPAY_AUTH_TRUST_GATEWAY=true if a gateway verifies every token before this handler.'

function readEnv(name: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  const deno = (globalThis as { Deno?: { env?: { get(name: string): string | undefined } } }).Deno
  const value = proc?.env?.[name] ?? deno?.env?.get(name)
  return value && value.length > 0 ? value : undefined
}

function supabaseJwksUrl(): string | undefined {
  const base = readEnv('SUPABASE_URL')
  return base ? `${base.replace(/\/+$/, '')}/auth/v1/.well-known/jwks.json` : undefined
}

const jwksSets = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function jwksFor(url: string): ReturnType<typeof createRemoteJWKSet> {
  let set = jwksSets.get(url)
  if (!set) {
    set = createRemoteJWKSet(new URL(url))
    jwksSets.set(url, set)
  }
  return set
}

export async function verifyBearerToken(
  token: string,
  options: VerifyBearerTokenOptions = {},
): Promise<TokenVerification> {
  const strict = readEnv('SOLVAPAY_AUTH_STRICT') === 'true'
  const trustGateway = options.trustGateway ?? readEnv('SOLVAPAY_AUTH_TRUST_GATEWAY') === 'true'
  if (strict && trustGateway) {
    return {
      ok: false,
      reason:
        'SOLVAPAY_AUTH_STRICT=true forbids trusting a gateway, but gateway trust is on. Turn one of them off.',
    }
  }

  let alg: unknown
  try {
    alg = decodeProtectedHeader(token).alg
  } catch {
    return { ok: false, reason: 'Malformed authentication token' }
  }

  if (alg === 'HS256') {
    const secret =
      options.jwtSecret || readEnv('SOLVAPAY_JWT_SECRET') || readEnv('SUPABASE_JWT_SECRET')
    if (secret) {
      try {
        const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
          algorithms: ['HS256'],
        })
        return { ok: true, payload, verifiedBy: 'secret' }
      } catch {
        return { ok: false, reason: 'Invalid or expired authentication token' }
      }
    }
  } else if (typeof alg === 'string' && ASYMMETRIC_ALGORITHMS.includes(alg)) {
    const jwksUrl = options.jwksUrl || readEnv('SOLVAPAY_JWKS_URL') || supabaseJwksUrl()
    if (jwksUrl) {
      try {
        const { payload } = await jwtVerify(token, jwksFor(jwksUrl), {
          algorithms: ASYMMETRIC_ALGORITHMS,
        })
        return { ok: true, payload, verifiedBy: 'jwks' }
      } catch {
        return { ok: false, reason: 'Invalid or expired authentication token' }
      }
    }
  } else {
    return { ok: false, reason: `Unsupported authentication token algorithm: ${String(alg)}` }
  }

  if (!trustGateway) {
    return { ok: false, reason: TOKEN_NOT_VERIFIABLE }
  }
  let payload: JWTPayload
  try {
    payload = decodeJwt(token)
  } catch {
    return { ok: false, reason: 'Malformed authentication token' }
  }
  // The gateway checked the signature; an expired token still isn't used.
  if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) {
    return { ok: false, reason: 'Invalid or expired authentication token' }
  }
  return { ok: true, payload, verifiedBy: 'gateway' }
}
