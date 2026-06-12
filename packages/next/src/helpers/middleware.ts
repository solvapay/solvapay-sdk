/**
 * Next.js Middleware Helpers
 *
 * Helpers for creating authentication middleware in Next.js.
 * Works with any AuthAdapter implementation (Supabase, Auth0, custom, etc.)
 */

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import type { AuthAdapter } from '@solvapay/auth'
import { SOLVAPAY_AUTHORIZATION_HEADER, SOLVAPAY_USER_ID_HEADER } from '@solvapay/auth'
import { createAuth0AuthAdapter, type Auth0ClientLike } from '@solvapay/auth/auth0'

/**
 * Configuration options for authentication middleware
 */
export interface AuthMiddlewareOptions {
  /**
   * Auth adapter instance to use for extracting user IDs from requests
   * You can use SupabaseAuthAdapter, MockAuthAdapter, or create your own
   */
  adapter: AuthAdapter

  /**
   * Public routes that don't require authentication
   * Routes are matched using pathname.startsWith()
   */
  publicRoutes?: string[]

  /**
   * Header name to store the user ID (default: `x-user-id`)
   */
  userIdHeader?: string

  /**
   * When true, process all matched routes (not only `/api/*`).
   * Use with session-based adapters (Auth0) that refresh cookies on every request.
   * Default: false (legacy Supabase API-only behaviour).
   */
  processAllRoutes?: boolean

  /**
   * When `processAllRoutes` is true, only enforce 401 on paths starting with this prefix.
   * Default: `/api`
   */
  protectedRoutePrefix?: string
}

function mergeSetCookies(target: NextResponse, source: Response): void {
  for (const cookie of source.headers.getSetCookie()) {
    target.headers.append('set-cookie', cookie)
  }
}

async function resolveIdentity(
  adapter: AuthAdapter,
  req: NextRequest,
): Promise<{ userId: string; claimsToken?: string } | null> {
  if (adapter.getIdentityFromRequest) {
    return adapter.getIdentityFromRequest(req)
  }

  const userId = await adapter.getUserIdFromRequest(req)
  if (!userId) {
    return null
  }

  return { userId }
}

function buildForwardResponse(
  req: NextRequest,
  userIdHeader: string,
  identity: { userId: string; claimsToken?: string } | null,
): NextResponse {
  const requestHeaders = new Headers(req.headers)

  // Strip client-supplied identity headers so they can never be spoofed past
  // the middleware. We only re-set them below from a verified session identity.
  requestHeaders.delete(userIdHeader)
  requestHeaders.delete(SOLVAPAY_AUTHORIZATION_HEADER)

  if (identity) {
    requestHeaders.set(userIdHeader, identity.userId)
    if (identity.claimsToken) {
      requestHeaders.set(SOLVAPAY_AUTHORIZATION_HEADER, `Bearer ${identity.claimsToken}`)
    }
  }

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  })
}

function getPathname(req: NextRequest): string {
  if (req.nextUrl) {
    return req.nextUrl.pathname
  }
  return new URL(req.url).pathname
}

/**
 * Creates a Next.js middleware function for authentication
 */
export function createAuthMiddleware(options: AuthMiddlewareOptions) {
  const {
    adapter,
    publicRoutes = [],
    userIdHeader = SOLVAPAY_USER_ID_HEADER,
    processAllRoutes = false,
    protectedRoutePrefix = '/api',
  } = options

  return async function middleware(request: NextRequest) {
    const req = request
    const pathname = getPathname(req)

    if (!processAllRoutes && !pathname.startsWith('/api')) {
      return NextResponse.next()
    }

    const handleResult = adapter.handleRequest ? await adapter.handleRequest(req) : null

    if (handleResult?.ownsRequest && handleResult.response) {
      return handleResult.response
    }

    const isPublicRoute = publicRoutes.some(route => pathname.startsWith(route))
    const identity = await resolveIdentity(adapter, req)
    const userId = identity?.userId ?? null

    const isProtectedApiRoute =
      pathname.startsWith(protectedRoutePrefix) && !isPublicRoute

    if (isProtectedApiRoute && !userId) {
      const unauthorized = NextResponse.json(
        { error: 'Unauthorized', details: 'Valid authentication required' },
        { status: 401 },
      )
      if (handleResult?.sessionResponse) {
        mergeSetCookies(unauthorized, handleResult.sessionResponse)
      }
      return unauthorized
    }

    const forward = buildForwardResponse(req, userIdHeader, identity)

    if (handleResult?.sessionResponse) {
      mergeSetCookies(forward, handleResult.sessionResponse)
    }

    return forward
  }
}

/**
 * Configuration options for Auth0 authentication middleware
 */
export interface Auth0AuthMiddlewareOptions {
  /**
   * Auth0 client instance used by the adapter.
   */
  auth0: Auth0ClientLike

  /**
   * Public routes that don't require authentication.
   */
  publicRoutes?: string[]

  /**
   * Route prefix owned by Auth0 (default: `/auth`).
   */
  authRoutePrefix?: string

  /**
   * Header name to store the user ID (default: `x-user-id`)
   */
  userIdHeader?: string

  /**
   * Route prefix that enforces 401 when unauthenticated (default: `/api`)
   */
  protectedRoutePrefix?: string
}

/**
 * Creates a Next.js middleware function for Auth0 authentication.
 */
export function createAuth0AuthMiddleware(options: Auth0AuthMiddlewareOptions) {
  const {
    auth0,
    authRoutePrefix,
    publicRoutes = [],
    userIdHeader = SOLVAPAY_USER_ID_HEADER,
    protectedRoutePrefix = '/api',
  } = options

  return createAuthMiddleware({
    adapter: createAuth0AuthAdapter({ auth0, authRoutePrefix }),
    publicRoutes,
    userIdHeader,
    protectedRoutePrefix,
    processAllRoutes: true,
  })
}

/**
 * Configuration options for Supabase authentication middleware
 */
export interface SupabaseAuthMiddlewareOptions {
  jwtSecret?: string
  publicRoutes?: string[]
  userIdHeader?: string
}

/**
 * Creates a Next.js middleware function for Supabase authentication
 */
export function createSupabaseAuthMiddleware(options: SupabaseAuthMiddlewareOptions = {}) {
  const { jwtSecret, publicRoutes = [], userIdHeader = SOLVAPAY_USER_ID_HEADER } = options

  let authAdapter: AuthAdapter | null = null
  let adapterPromise: Promise<AuthAdapter> | null = null

  const lazyAdapter: AuthAdapter = {
    async getUserIdFromRequest(req) {
      if (!authAdapter) {
        if (!adapterPromise) {
          adapterPromise = (async () => {
            const secret = jwtSecret || process.env.SUPABASE_JWT_SECRET

            if (!secret) {
              throw new Error(
                'SUPABASE_JWT_SECRET environment variable is required. ' +
                  'Please set it in your .env.local file. ' +
                  'Get it from: Supabase Dashboard → Settings → API → JWT Secret',
              )
            }

            const { SupabaseAuthAdapter } = await import('@solvapay/auth/supabase')
            authAdapter = new SupabaseAuthAdapter({ jwtSecret: secret })
            return authAdapter
          })()
        }

        authAdapter = await adapterPromise
      }

      return authAdapter.getUserIdFromRequest(req)
    },
  }

  return createAuthMiddleware({
    adapter: lazyAdapter,
    publicRoutes,
    userIdHeader,
    processAllRoutes: false,
  })
}
