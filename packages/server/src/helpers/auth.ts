/**
 * Authentication Helper (Core)
 *
 * Generic helper for extracting authenticated user information from requests.
 * Works with standard Web API Request (works everywhere).
 */

import type { AuthenticatedUser, ErrorResult } from './types'
import { handleRouteError } from './error'

/**
 * JWT payload shape we care about (Supabase/JWT conventions).
 */
type JwtPayload = {
  sub?: unknown
  email?: unknown
  name?: unknown
  user_metadata?: {
    full_name?: unknown
    name?: unknown
  }
}

/**
 * Base64url decode a string into a UTF-8 string.
 * Runtime-agnostic: works in Node, Deno, Bun, and Edge runtimes.
 */
function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
  const padding = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4))
  const base64 = padded + padding

  // Prefer globalThis.atob (available in all modern runtimes including Node 18+).
  if (typeof atob === 'function') {
    const binary = atob(base64)
    let result = ''
    for (let i = 0; i < binary.length; i++) {
      result += String.fromCharCode(binary.charCodeAt(i))
    }
    // Decode as UTF-8.
    try {
      return decodeURIComponent(escape(result))
    } catch {
      return result
    }
  }

  // Last-resort Buffer fallback (Node only).
  const BufferCtor = (globalThis as { Buffer?: { from(s: string, enc: string): { toString(enc: string): string } } })
    .Buffer
  if (BufferCtor) {
    return BufferCtor.from(base64, 'base64').toString('utf-8')
  }

  throw new Error('No base64 decoder available in this runtime')
}

/**
 * Unverified JWT payload decode. Returns null if the token is malformed.
 *
 * This does NOT verify the signature. It's safe to use when the platform
 * gateway (e.g. Supabase Edge's verify_jwt=true) has already validated the
 * token before our handler runs. Set SOLVAPAY_AUTH_STRICT=true + provide a
 * JWT secret to require cryptographic verification inside the function.
 */
function decodeJwtUnverified(token: string): JwtPayload | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const json = base64UrlDecode(parts[1])
    const payload = JSON.parse(json) as unknown
    if (typeof payload !== 'object' || payload === null) return null
    return payload as JwtPayload
  } catch {
    return null
  }
}

function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get('authorization')
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) return null
  const token = authHeader.slice(7).trim()
  return token.length > 0 ? token : null
}

function readEnv(name: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  return proc?.env?.[name]
}

function isStrictMode(): boolean {
  return readEnv('SOLVAPAY_AUTH_STRICT') === 'true'
}

function getConfiguredSecret(): string | undefined {
  return readEnv('SOLVAPAY_JWT_SECRET') || readEnv('SUPABASE_JWT_SECRET')
}

/**
 * Verify a Bearer JWT using HS256 against the configured secret.
 * Returns the payload on success, or null on any failure.
 */
async function verifyHs256(token: string, secret: string): Promise<JwtPayload | null> {
  try {
    const { jwtVerify } = await import('jose')
    const key = new TextEncoder().encode(secret)
    const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] })
    return payload as JwtPayload
  } catch {
    return null
  }
}

function pickName(payload: JwtPayload): string | null {
  const metadataFullName =
    typeof payload.user_metadata?.full_name === 'string' ? payload.user_metadata.full_name : null
  const metadataName =
    typeof payload.user_metadata?.name === 'string' ? payload.user_metadata.name : null
  const claimName = typeof payload.name === 'string' ? payload.name : null
  return metadataFullName || metadataName || claimName || null
}

function pickEmail(payload: JwtPayload): string | null {
  return typeof payload.email === 'string' ? payload.email : null
}

function unauthorized(details: string): ErrorResult {
  return { error: 'Unauthorized', status: 401, details }
}

/**
 * Extract authenticated user information from a standard Web API Request.
 *
 * This is a generic, framework-agnostic helper that extracts user ID, email,
 * and name from authenticated requests. Works with any framework that uses
 * the standard Web API Request (Express, Fastify, Next.js, Edge Functions, etc.).
 *
 * Resolution order:
 * 1. `x-user-id` header — set by Next.js-style middleware (unchanged).
 * 2. `Authorization: Bearer <jwt>` — verified via HS256 when a secret is
 *    configured (`SOLVAPAY_JWT_SECRET` or `SUPABASE_JWT_SECRET`), or
 *    unverified-decoded when no secret is configured. The unverified path
 *    covers platforms that verify JWTs at the gateway (e.g. Supabase Edge
 *    with `verify_jwt = true`, which is the default) and asymmetric signing
 *    keys (ES256/RS256) that the SDK does not have keys for.
 * 3. Set `SOLVAPAY_AUTH_STRICT=true` to require cryptographic verification
 *    inside the handler (the unverified-decode fallback is then disabled).
 *
 * @param request - Standard Web API Request object
 * @param options - Configuration options
 * @param options.includeEmail - Whether to extract email from JWT token (default: true)
 * @param options.includeName - Whether to extract name from JWT token (default: true)
 * @returns Authenticated user info or error result
 *
 * @example
 * ```typescript
 * // In an API route handler
 * export async function GET(request: Request) {
 *   const userResult = await getAuthenticatedUserCore(request);
 *
 *   if (isErrorResult(userResult)) {
 *     return Response.json(userResult, { status: userResult.status });
 *   }
 *
 *   const { userId, email, name } = userResult;
 *   // Use user info...
 * }
 * ```
 *
 * @see {@link AuthenticatedUser} for the return type
 * @see {@link ErrorResult} for error handling
 * @since 1.0.0
 */
export async function getAuthenticatedUserCore(
  request: Request,
  options: {
    includeEmail?: boolean
    includeName?: boolean
  } = {},
): Promise<AuthenticatedUser | ErrorResult> {
  try {
    const includeEmail = options.includeEmail !== false
    const includeName = options.includeName !== false

    const headerUserId = request.headers.get('x-user-id')
    if (headerUserId) {
      let email: string | null = null
      let name: string | null = null

      if (includeEmail || includeName) {
        const token = extractBearerToken(request)
        if (token) {
          const secret = getConfiguredSecret()
          const payload = secret
            ? await verifyHs256(token, secret)
            : isStrictMode()
              ? null
              : decodeJwtUnverified(token)
          if (payload) {
            if (includeEmail) email = pickEmail(payload)
            if (includeName) name = pickName(payload)
          }
        }
      }

      return { userId: headerUserId, email, name }
    }

    const token = extractBearerToken(request)
    if (!token) {
      return unauthorized('User ID not found. Ensure middleware is configured.')
    }

    const secret = getConfiguredSecret()
    let payload: JwtPayload | null = null

    if (secret) {
      payload = await verifyHs256(token, secret)
      if (!payload) {
        return unauthorized('Invalid or expired authentication token')
      }
    } else if (isStrictMode()) {
      return unauthorized(
        'Strict auth mode is enabled but no JWT secret is configured. Set SOLVAPAY_JWT_SECRET or SUPABASE_JWT_SECRET.',
      )
    } else {
      payload = decodeJwtUnverified(token)
      if (!payload) {
        return unauthorized('Malformed authentication token')
      }
    }

    const userId = typeof payload.sub === 'string' ? payload.sub : null
    if (!userId) {
      return unauthorized('Authentication token missing subject (sub) claim')
    }

    return {
      userId,
      email: includeEmail ? pickEmail(payload) : null,
      name: includeName ? pickName(payload) : null,
    }
  } catch (error) {
    return handleRouteError(error, 'Get authenticated user', 'Authentication failed')
  }
}
