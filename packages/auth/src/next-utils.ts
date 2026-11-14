/**
 * Next.js Route Utilities
 *
 * Helper functions for common patterns in Next.js API routes.
 * These utilities work with authenticated requests where user IDs
 * have been extracted and set in headers (e.g., by middleware).
 *
 * Note: These functions work with the standard web Request API
 * and can be used with Next.js NextRequest (which extends Request)
 */

import { verifyBearerToken } from './verify-token'

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

function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get('authorization')
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) return null
  const token = authHeader.slice(7).trim()
  return token.length > 0 ? token : null
}

async function resolveJwtPayload(token: string, jwtSecret?: string): Promise<JwtPayload | null> {
  const verified = await verifyBearerToken(token, { jwtSecret })
  return verified.ok ? (verified.payload as JwtPayload) : null
}

/**
 * Extract user ID from request headers.
 *
 * Checks for the 'x-user-id' header which is commonly set by authentication
 * middleware after successful authentication. This header is typically set
 * by Next.js middleware that validates JWT tokens or session cookies.
 *
 * @param request - Request object (works with NextRequest from next/server)
 * @param options - Configuration options
 * @param options.headerName - Custom header name (default: 'x-user-id')
 * @returns User ID string or null if not found
 *
 * @example
 * ```typescript
 * import { NextRequest, NextResponse } from 'next/server';
 * import { getUserIdFromRequest } from '@solvapay/auth';
 *
 * export async function GET(request: NextRequest) {
 *   const userId = getUserIdFromRequest(request);
 *
 *   if (!userId) {
 *     return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
 *   }
 *
 *   // Use userId...
 *   return NextResponse.json({ userId });
 * }
 * ```
 *
 * @see {@link requireUserId} for a version that returns an error response
 * @since 1.0.0
 */
export function getUserIdFromRequest(
  request: Request,
  options?: {
    headerName?: string
  },
): string | null {
  const headerName = options?.headerName || 'x-user-id'
  return request.headers.get(headerName)
}

/**
 * Extract user email from a Bearer JWT in the Authorization header.
 *
 * The token is verified first, as `verifyBearerToken` does: HS256 with
 * `options.jwtSecret` / `SOLVAPAY_JWT_SECRET` / `SUPABASE_JWT_SECRET`,
 * ES256/RS256 against `SOLVAPAY_JWKS_URL` (or Supabase's JWKS from
 * `SUPABASE_URL`), or a gateway you trust with
 * `SOLVAPAY_AUTH_TRUST_GATEWAY=true`. A token none of these verifies gives
 * `null`.
 *
 * @param request - Request object (works with NextRequest from next/server)
 * @param options - Configuration options
 * @param options.jwtSecret - JWT secret (defaults to SOLVAPAY_JWT_SECRET / SUPABASE_JWT_SECRET env var)
 * @returns User email string or null if not found
 *
 * @see {@link getUserNameFromRequest} for extracting user name
 * @since 1.0.0
 */
export async function getUserEmailFromRequest(
  request: Request,
  options?: {
    jwtSecret?: string
  },
): Promise<string | null> {
  const token = extractBearerToken(request)
  if (!token) return null

  const payload = await resolveJwtPayload(token, options?.jwtSecret)
  if (!payload) return null

  return typeof payload.email === 'string' ? payload.email : null
}

/**
 * Extract user name from a Bearer JWT in the Authorization header.
 *
 * Checks multiple possible locations:
 * - `user_metadata.full_name`
 * - `user_metadata.name`
 * - `name` claim
 *
 * See {@link getUserEmailFromRequest} for the verification/fallback model.
 *
 * @param request - Request object (works with NextRequest from next/server)
 * @param options - Configuration options
 * @param options.jwtSecret - JWT secret (defaults to SOLVAPAY_JWT_SECRET / SUPABASE_JWT_SECRET env var)
 * @returns User name string or null if not found
 *
 * @see {@link getUserEmailFromRequest} for extracting user email
 * @since 1.0.0
 */
export async function getUserNameFromRequest(
  request: Request,
  options?: {
    jwtSecret?: string
  },
): Promise<string | null> {
  const token = extractBearerToken(request)
  if (!token) return null

  const payload = await resolveJwtPayload(token, options?.jwtSecret)
  if (!payload) return null

  const metadataFullName =
    typeof payload.user_metadata?.full_name === 'string' ? payload.user_metadata.full_name : null
  const metadataName =
    typeof payload.user_metadata?.name === 'string' ? payload.user_metadata.name : null
  const claimName = typeof payload.name === 'string' ? payload.name : null

  return metadataFullName || metadataName || claimName || null
}

/**
 * Require user ID from request headers or return an error response.
 *
 * This is a convenience function that combines `getUserIdFromRequest()` with
 * error handling. If the user ID is not found, it returns a Response object
 * with a 401 status that can be directly returned from Next.js route handlers.
 *
 * Returns a standard Response object that works with Next.js (NextResponse
 * extends Response, so this is fully compatible).
 *
 * @param request - Request object (works with NextRequest from next/server)
 * @param options - Configuration options
 * @param options.headerName - Custom header name (default: 'x-user-id')
 * @param options.errorMessage - Custom error message (default: 'Unauthorized')
 * @param options.errorDetails - Custom error details (default: 'User ID not found. Ensure middleware is configured.')
 * @returns Either the user ID string or a Response error object with 401 status
 *
 * @example
 * ```typescript
 * import { NextRequest, NextResponse } from 'next/server';
 * import { requireUserId } from '@solvapay/auth';
 *
 * export async function GET(request: NextRequest) {
 *   const userIdOrError = requireUserId(request);
 *
 *   if (userIdOrError instanceof Response) {
 *     return userIdOrError; // Returns 401 error
 *   }
 *
 *   // userIdOrError is now a string
 *   const userId = userIdOrError;
 *   // Use userId...
 * }
 * ```
 *
 * @see {@link getUserIdFromRequest} for a version that returns null instead of error
 * @since 1.0.0
 */
export function requireUserId(
  request: Request,
  options?: {
    headerName?: string
    errorMessage?: string
    errorDetails?: string
  },
): string | Response {
  const headerName = options?.headerName || 'x-user-id'
  const errorMessage = options?.errorMessage || 'Unauthorized'
  const errorDetails =
    options?.errorDetails || 'User ID not found. Ensure middleware is configured.'

  const userId = request.headers.get(headerName)

  if (!userId) {
    return new Response(JSON.stringify({ error: errorMessage, details: errorDetails }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return userId
}
