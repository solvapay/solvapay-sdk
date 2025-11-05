/**
 * Next.js Middleware Helpers
 * 
 * Helpers for creating authentication middleware in Next.js.
 * Works with any AuthAdapter implementation (Supabase, custom, etc.)
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import type { AuthAdapter } from '@solvapay/auth';

/**
 * Configuration options for authentication middleware
 */
export interface AuthMiddlewareOptions {
  /**
   * Auth adapter instance to use for extracting user IDs from requests
   * You can use SupabaseAuthAdapter, MockAuthAdapter, or create your own
   */
  adapter: AuthAdapter;
  
  /**
   * Public routes that don't require authentication
   * Routes are matched using pathname.startsWith()
   */
  publicRoutes?: string[];
  
  /**
   * Header name to store the user ID (default: 'x-user-id')
   */
  userIdHeader?: string;
}

/**
 * Creates a Next.js middleware function for authentication
 * 
 * This helper:
 * 1. Uses the provided AuthAdapter to extract userId from requests
 * 2. Handles public vs protected routes
 * 3. Adds userId to request headers for downstream routes
 * 4. Returns appropriate error responses for auth failures
 * 
 * @param options - Configuration options
 * @returns Next.js middleware function (can be exported as `middleware` or `proxy`)
 * 
 * @example Next.js 15
 * ```typescript
 * // middleware.ts (at project root)
 * import { createAuthMiddleware } from '@solvapay/next';
 * import { SupabaseAuthAdapter } from '@solvapay/auth/supabase';
 * 
 * const adapter = new SupabaseAuthAdapter({
 *   jwtSecret: process.env.SUPABASE_JWT_SECRET!,
 * });
 * 
 * export const middleware = createAuthMiddleware({
 *   adapter,
 *   publicRoutes: ['/api/list-plans'],
 * });
 * 
 * export const config = {
 *   matcher: ['/api/:path*'],
 * };
 * ```
 * 
 * @example Next.js 16 with src/ folder
 * ```typescript
 * // src/proxy.ts (in src/ folder, not project root)
 * import { createAuthMiddleware } from '@solvapay/next';
 * import { SupabaseAuthAdapter } from '@solvapay/auth/supabase';
 * 
 * const adapter = new SupabaseAuthAdapter({
 *   jwtSecret: process.env.SUPABASE_JWT_SECRET!,
 * });
 * 
 * // Use 'proxy' export for Next.js 16 (no deprecation warning)
 * export const proxy = createAuthMiddleware({
 *   adapter,
 *   publicRoutes: ['/api/list-plans'],
 * });
 * 
 * export const config = {
 *   matcher: ['/api/:path*'],
 * };
 * ```
 * 
 * @example Custom adapter
 * ```typescript
 * import { createAuthMiddleware } from '@solvapay/next';
 * import type { AuthAdapter } from '@solvapay/auth';
 * 
 * const myAdapter: AuthAdapter = {
 *   async getUserIdFromRequest(req) {
 *     // Your custom auth logic
 *     return userId;
 *   },
 * };
 * 
 * export const middleware = createAuthMiddleware({
 *   adapter: myAdapter,
 * });
 * ```
 * 
 * **File Location Notes:**
 * - **Next.js 15**: Place `middleware.ts` at project root
 * - **Next.js 16 without `src/` folder**: Place `middleware.ts` or `proxy.ts` at project root
 * - **Next.js 16 with `src/` folder**: Place `src/proxy.ts` or `src/middleware.ts` (in `src/` folder, not root)
 * 
 * **Note:** Next.js 16 renamed "middleware" to "proxy". You can export the return value as either
 * `middleware` or `proxy` - both work, but `proxy` is recommended to avoid deprecation warnings.
 */
export function createAuthMiddleware(options: AuthMiddlewareOptions) {
  const {
    adapter,
    publicRoutes = [],
    userIdHeader = 'x-user-id',
  } = options;

  return async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Only process API routes
    if (!pathname.startsWith('/api')) {
      return NextResponse.next();
    }

    // Check if route is public
    const isPublicRoute = publicRoutes.some(route => pathname.startsWith(route));

    // Extract userId from request using the adapter
    const userId = await adapter.getUserIdFromRequest(request);

    // For public routes, allow access even without auth, but still set userId if available
    if (isPublicRoute) {
      const requestHeaders = new Headers(request.headers);
      if (userId) {
        requestHeaders.set(userIdHeader, userId);
      }
      return NextResponse.next({
        request: {
          headers: requestHeaders,
        },
      });
    }

    // For protected routes, require authentication
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized', details: 'Valid authentication required' },
        { status: 401 }
      );
    }

    // Clone request headers and add userId for downstream routes
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set(userIdHeader, userId);

    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  };
}

/**
 * Configuration options for Supabase authentication middleware
 */
export interface SupabaseAuthMiddlewareOptions {
  /**
   * Supabase JWT secret (from Supabase dashboard: Settings → API → JWT Secret)
   * If not provided, will use SUPABASE_JWT_SECRET environment variable
   */
  jwtSecret?: string;
  
  /**
   * Public routes that don't require authentication
   * Routes are matched using pathname.startsWith()
   */
  publicRoutes?: string[];
  
  /**
   * Header name to store the user ID (default: 'x-user-id')
   */
  userIdHeader?: string;
}

/**
 * Creates a Next.js middleware function for Supabase authentication
 * 
 * Convenience function that creates a SupabaseAuthAdapter and wraps it with createAuthMiddleware.
 * Only use this if you're using Supabase - otherwise use createAuthMiddleware with your own adapter.
 * 
 * Uses dynamic import to avoid requiring Supabase as a dependency in @solvapay/next.
 * 
 * @param options - Configuration options
 * @returns Next.js middleware function (can be exported as `middleware` or `proxy`)
 * 
 * @example Next.js 15
 * ```typescript
 * // middleware.ts (at project root)
 * import { createSupabaseAuthMiddleware } from '@solvapay/next';
 * 
 * export const middleware = createSupabaseAuthMiddleware({
 *   publicRoutes: ['/api/list-plans'],
 * });
 * 
 * export const config = {
 *   matcher: ['/api/:path*'],
 * };
 * ```
 * 
 * @example Next.js 16 with src/ folder
 * ```typescript
 * // src/proxy.ts (in src/ folder, not project root)
 * import { createSupabaseAuthMiddleware } from '@solvapay/next';
 * 
 * // Use 'proxy' export for Next.js 16 (no deprecation warning)
 * export const proxy = createSupabaseAuthMiddleware({
 *   publicRoutes: ['/api/list-plans'],
 * });
 * 
 * export const config = {
 *   matcher: ['/api/:path*'],
 * };
 * ```
 * 
 * **File Location Notes:**
 * - **Next.js 15**: Place `middleware.ts` at project root
 * - **Next.js 16 without `src/` folder**: Place `middleware.ts` or `proxy.ts` at project root
 * - **Next.js 16 with `src/` folder**: Place `src/proxy.ts` or `src/middleware.ts` (in `src/` folder, not root)
 * 
 * **Note:** Next.js 16 renamed "middleware" to "proxy". You can export the return value as either
 * `middleware` or `proxy` - both work, but `proxy` is recommended to avoid deprecation warnings.
 */
export function createSupabaseAuthMiddleware(options: SupabaseAuthMiddlewareOptions = {}) {
  const {
    jwtSecret,
    publicRoutes = [],
    userIdHeader = 'x-user-id',
  } = options;

  // Lazy initialization of auth adapter (Edge runtime compatible)
  let authAdapter: AuthAdapter | null = null;
  let adapterPromise: Promise<AuthAdapter> | null = null;

  // Create a wrapper adapter that lazily initializes the Supabase adapter
  const lazyAdapter: AuthAdapter = {
    async getUserIdFromRequest(req) {
      // Initialize adapter on first use (with dynamic import)
      if (!authAdapter) {
        if (!adapterPromise) {
          adapterPromise = (async () => {
            const secret = jwtSecret || process.env.SUPABASE_JWT_SECRET;
            
            if (!secret) {
              throw new Error(
                'SUPABASE_JWT_SECRET environment variable is required. ' +
                'Please set it in your .env.local file. ' +
                'Get it from: Supabase Dashboard → Settings → API → JWT Secret'
              );
            }
            
            // Dynamic import to avoid requiring Supabase as a dependency
            // This allows the package to work without Supabase dependencies
            const { SupabaseAuthAdapter } = await import('@solvapay/auth/supabase');
            authAdapter = new SupabaseAuthAdapter({ jwtSecret: secret });
            return authAdapter;
          })();
        }
        
        authAdapter = await adapterPromise;
      }
      
      return authAdapter.getUserIdFromRequest(req);
    },
  };

  return createAuthMiddleware({
    adapter: lazyAdapter,
    publicRoutes,
    userIdHeader,
  });
}

