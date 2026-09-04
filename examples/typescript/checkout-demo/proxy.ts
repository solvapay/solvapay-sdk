import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAuthMiddleware } from '@solvapay/next/middleware'
import { demoAuthMode } from './app/lib/auth-mode'

const PUBLIC_ROUTES = [
  '/api/list-plans',
  '/api/merchant',
  '/api/get-product',
  // Next.js treats `_folder` as private (no route), so diag lives at /api/diag/*
  // (next.config rewrites /api/_diag/* → /api/diag/* for the plan's curl path).
  '/api/diag/impl',
  '/api/diag/impl-edge',
  '/api/_diag/impl',
  '/api/_diag/impl-edge',
]

/** Edge proxy for Supabase JWT auth on /api/* routes. */
const supabaseProxy = createSupabaseAuthMiddleware({ publicRoutes: PUBLIC_ROUTES })

/**
 * Anonymous mode: there is no session to verify, so the browser owns the
 * customer ref and sends it as `x-customer-ref`. Promote it to `x-user-id`,
 * which is the header the SolvaPay route helpers read.
 */
function anonymousProxy(request: NextRequest) {
  const customerRef = request.headers.get('x-customer-ref')
  if (!customerRef) return NextResponse.next()

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-user-id', customerRef)
  return NextResponse.next({ request: { headers: requestHeaders } })
}

export function proxy(request: NextRequest) {
  return demoAuthMode === 'anonymous' ? anonymousProxy(request) : supabaseProxy(request)
}

export const config = {
  matcher: ['/api/:path*'],
}
