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

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
  const padding = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4))
  const base64 = padded + padding

  if (typeof atob === 'function') {
    const binary = atob(base64)
    let result = ''
    for (let i = 0; i < binary.length; i++) {
      result += String.fromCharCode(binary.charCodeAt(i))
    }
    try {
      return decodeURIComponent(escape(result))
    } catch {
      return result
    }
  }

  const BufferCtor = (globalThis as { Buffer?: { from(s: string, enc: string): { toString(enc: string): string } } })
    .Buffer
  if (BufferCtor) {
    return BufferCtor.from(base64, 'base64').toString('utf-8')
  }

  throw new Error('No base64 decoder available in this runtime')
}

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

async function resolveJwtPayload(token: string, jwtSecret?: string): Promise<JwtPayload | null> {
  const secret = jwtSecret || readEnv('SOLVAPAY_JWT_SECRET') || readEnv('SUPABASE_JWT_SECRET')

  if (secret) {
    try {
      const { jwtVerify } = await import('jose')
      const key = new TextEncoder().encode(secret)
      const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] })
      return payload as JwtPayload
    } catch {
      return null
    }
  }

  if (isStrictMode()) return null

  return decodeJwtUnverified(token)
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
 * When `SOLVAPAY_JWT_SECRET` or `SUPABASE_JWT_SECRET` is set (or the
 * equivalent `options.jwtSecret`), the token is verified via HS256.
 * Otherwise, the payload is decoded without verification — safe when the
 * platform gateway has already validated the token (e.g. Supabase Edge
 * Functions with `verify_jwt = true`, which is the default). Opt into
 * strict mode with `SOLVAPAY_AUTH_STRICT=true` to disable the
 * unverified-decode fallback.
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
