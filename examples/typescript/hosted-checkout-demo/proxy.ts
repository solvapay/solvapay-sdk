import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAuthMiddleware } from '@solvapay/next/middleware'
import { demoAuthMode } from './app/lib/auth-mode'

/**
 * Next.js Proxy for Authentication
 *
 * Extracts the customer identity from the incoming request and hands it to the
 * API routes as `x-user-id`. This centralizes auth logic and makes it available
 * to all downstream routes.
 */
const supabaseProxy = createSupabaseAuthMiddleware({ publicRoutes: [] })

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
