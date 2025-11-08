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
 * Extract user email from Supabase JWT token in Authorization header.
 *
 * Parses and validates a Supabase JWT token from the Authorization header
 * and extracts the email claim. Returns null if the token is missing, invalid,
 * or expired.
 *
 * Uses dynamic imports for Edge runtime compatibility.
 *
 * @param request - Request object (works with NextRequest from next/server)
 * @param options - Configuration options
 * @param options.jwtSecret - Supabase JWT secret (defaults to SUPABASE_JWT_SECRET env var)
 * @returns User email string or null if not found
 *
 * @example
 * ```typescript
 * import { NextRequest, NextResponse } from 'next/server';
 * import { getUserEmailFromRequest } from '@solvapay/auth';
 *
 * export async function GET(request: NextRequest) {
 *   const email = await getUserEmailFromRequest(request);
 *
 *   if (!email) {
 *     return NextResponse.json({ error: 'Email not found' }, { status: 401 });
 *   }
 *
 *   return NextResponse.json({ email });
 * }
 * ```
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
  const authHeader = request.headers.get('authorization')

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }

  const token = authHeader.slice(7)
  if (!token) {
    return null
  }

  try {
    // Dynamic import to avoid requiring jose if not used (Edge-compatible)
    const { jwtVerify } = await import('jose')

    const jwtSecret = options?.jwtSecret || process.env.SUPABASE_JWT_SECRET
    if (!jwtSecret) {
      return null
    }

    const secret = new TextEncoder().encode(jwtSecret)
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ['HS256'],
    })

    // Extract email from payload (Supabase stores email in 'email' claim)
    return payload.email ? String(payload.email) : null
  } catch {
    // Return null on any error (invalid token, expired, etc.)
    return null
  }
}

/**
 * Extract user name from Supabase JWT token in Authorization header.
 *
 * Parses and validates a Supabase JWT token from the Authorization header
 * and extracts the name from user metadata. Checks multiple possible locations:
 * - `user_metadata.full_name`
 * - `user_metadata.name`
 * - `name` claim
 *
 * Returns null if the token is missing, invalid, or name is not found.
 *
 * @param request - Request object (works with NextRequest from next/server)
 * @param options - Configuration options
 * @param options.jwtSecret - Supabase JWT secret (defaults to SUPABASE_JWT_SECRET env var)
 * @returns User name string or null if not found
 *
 * @example
 * ```typescript
 * import { NextRequest, NextResponse } from 'next/server';
 * import { getUserNameFromRequest } from '@solvapay/auth';
 *
 * export async function GET(request: NextRequest) {
 *   const name = await getUserNameFromRequest(request);
 *
 *   return NextResponse.json({ name: name || 'Guest' });
 * }
 * ```
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
  const authHeader = request.headers.get('authorization')

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }

  const token = authHeader.slice(7)
  if (!token) {
    return null
  }

  try {
    // Dynamic import to avoid requiring jose if not used (Edge-compatible)
    const { jwtVerify } = await import('jose')

    const jwtSecret = options?.jwtSecret || process.env.SUPABASE_JWT_SECRET
    if (!jwtSecret) {
      return null
    }

    const secret = new TextEncoder().encode(jwtSecret)
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ['HS256'],
    })

    // Extract name from payload (Supabase stores name in 'user_metadata.full_name' or 'user_metadata.name' or 'name' claim)
    const name =
      (payload as any).user_metadata?.full_name ||
      (payload as any).user_metadata?.name ||
      (payload as any).name ||
      null
    return name ? String(name) : null
  } catch {
    // Return null on any error (invalid token, expired, etc.)
    return null
  }
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
