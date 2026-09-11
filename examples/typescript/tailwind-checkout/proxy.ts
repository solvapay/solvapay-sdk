import { NextResponse, type NextRequest } from 'next/server'

/**
 * Stub auth middleware.
 *
 * The example ships without real auth: every incoming request to the
 * SolvaPay catch-all is tagged with a fixed `x-user-id` so the
 * @solvapay/next helpers (via @solvapay/auth's `requireUserId`) can find
 * an authenticated user. Swap for the real auth flow when integrating.
 */
export function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-user-id', 'demo-user')
  return NextResponse.next({ request: { headers: requestHeaders } })
}

export const config = {
  matcher: ['/api/solvapay/:path*'],
}
