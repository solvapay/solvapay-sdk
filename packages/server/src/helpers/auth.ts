/**
 * Authentication Helper (Core)
 *
 * Generic helper for extracting authenticated user information from requests.
 * Works with standard Web API Request (works everywhere).
 */

import type { AuthenticatedUser, ErrorResult } from './types'
import { SOLVAPAY_USER_ID_HEADER, verifyBearerToken } from '@solvapay/auth'
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
function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get('authorization')
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) return null
  const token = authHeader.slice(7).trim()
  return token.length > 0 ? token : null
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
 * 1. `SOLVAPAY_USER_ID_HEADER` header — set by Next.js-style middleware (unchanged).
 * 2. `Authorization: Bearer <jwt>`, verified by `verifyBearerToken` from
 *    `@solvapay/auth`: HS256 with `SOLVAPAY_JWT_SECRET` / `SUPABASE_JWT_SECRET`,
 *    ES256/RS256 against `SOLVAPAY_JWKS_URL` (or Supabase's JWKS from
 *    `SUPABASE_URL`), or, only with `SOLVAPAY_AUTH_TRUST_GATEWAY=true`, a
 *    gateway that verified it already (Supabase Edge with `verify_jwt = true`).
 *    A token none of these verifies is refused with 401: there is no
 *    unverified default.
 *
 * Email and name come only from a verified token; with the header alone they
 * are null.
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

    const headerUserId = request.headers.get(SOLVAPAY_USER_ID_HEADER)
    if (headerUserId) {
      let email: string | null = null
      let name: string | null = null

      if (includeEmail || includeName) {
        const token = extractBearerToken(request)
        if (token) {
          const verified = await verifyBearerToken(token)
          if (verified.ok) {
            const payload = verified.payload as JwtPayload
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

    const verified = await verifyBearerToken(token)
    if (!verified.ok) {
      return unauthorized(verified.reason)
    }
    const payload = verified.payload as JwtPayload

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
