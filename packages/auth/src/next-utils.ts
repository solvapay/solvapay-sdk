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
 * Checks for 'x-user-id' header (commonly set by middleware after authentication).
 * 
 * @param request - Request object (works with NextRequest from next/server)
 * @param options - Configuration options
 * @returns User ID string or null if not found
 * 
 * @example
 * ```typescript
 * import { NextRequest, NextResponse } from 'next/server';
 * import { getUserIdFromRequest } from '@solvapay/auth';
 * 
 * const userId = getUserIdFromRequest(request);
 * if (!userId) {
 *   return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
 * }
 * ```
 */
export function getUserIdFromRequest(
  request: Request,
  options?: {
    headerName?: string;
  }
): string | null {
  const headerName = options?.headerName || 'x-user-id';
  return request.headers.get(headerName);
}

/**
 * Extract user email from Supabase JWT token in Authorization header.
 * Returns null if token is missing or invalid.
 * 
 * @param request - Request object (works with NextRequest from next/server)
 * @param options - Configuration options
 * @returns User email string or null if not found
 */
export async function getUserEmailFromRequest(
  request: Request,
  options?: {
    jwtSecret?: string;
  }
): Promise<string | null> {
  const authHeader = request.headers.get('authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7);
  if (!token) {
    return null;
  }

  try {
    // Dynamic import to avoid requiring jose if not used (Edge-compatible)
    const { jwtVerify } = await import('jose');
    
    const jwtSecret = options?.jwtSecret || process.env.SUPABASE_JWT_SECRET;
    if (!jwtSecret) {
      return null;
    }
    
    const secret = new TextEncoder().encode(jwtSecret);
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ['HS256']
    });

    // Extract email from payload (Supabase stores email in 'email' claim)
    return payload.email ? String(payload.email) : null;
  } catch {
    // Return null on any error (invalid token, expired, etc.)
    return null;
  }
}

/**
 * Extract user name from Supabase JWT token in Authorization header.
 * Returns null if token is missing or invalid.
 * 
 * @param request - Request object (works with NextRequest from next/server)
 * @param options - Configuration options
 * @returns User name string or null if not found
 */
export async function getUserNameFromRequest(
  request: Request,
  options?: {
    jwtSecret?: string;
  }
): Promise<string | null> {
  const authHeader = request.headers.get('authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7);
  if (!token) {
    return null;
  }

  try {
    // Dynamic import to avoid requiring jose if not used (Edge-compatible)
    const { jwtVerify } = await import('jose');
    
    const jwtSecret = options?.jwtSecret || process.env.SUPABASE_JWT_SECRET;
    if (!jwtSecret) {
      return null;
    }
    
    const secret = new TextEncoder().encode(jwtSecret);
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ['HS256']
    });

    // Extract name from payload (Supabase stores name in 'user_metadata.full_name' or 'user_metadata.name' or 'name' claim)
    const name = (payload as any).user_metadata?.full_name || (payload as any).user_metadata?.name || (payload as any).name || null;
    return name ? String(name) : null;
  } catch {
    // Return null on any error (invalid token, expired, etc.)
    return null;
  }
}

/**
 * Require user ID from request headers.
 * Returns an error response if user ID is not found.
 * 
 * This function returns a standard Response object that works with Next.js.
 * In Next.js, NextResponse extends Response, so this is compatible.
 * 
 * @param request - Request object (works with NextRequest from next/server)
 * @param options - Configuration options
 * @returns Either the user ID string or a Response error object
 * 
 * @example
 * ```typescript
 * import { NextRequest, NextResponse } from 'next/server';
 * import { requireUserId } from '@solvapay/auth';
 * 
 * const userIdOrError = requireUserId(request);
 * if (userIdOrError instanceof Response) {
 *   return userIdOrError; // Returns 401 error
 * }
 * // userIdOrError is now a string
 * const userId = userIdOrError;
 * ```
 */
export function requireUserId(
  request: Request,
  options?: {
    headerName?: string;
    errorMessage?: string;
    errorDetails?: string;
  }
): string | Response {
  const headerName = options?.headerName || 'x-user-id';
  const errorMessage = options?.errorMessage || 'Unauthorized';
  const errorDetails = options?.errorDetails || 'User ID not found. Ensure middleware is configured.';
  
  const userId = request.headers.get(headerName);
  
  if (!userId) {
    return new Response(
      JSON.stringify({ error: errorMessage, details: errorDetails }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
  
  return userId;
}

