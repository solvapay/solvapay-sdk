import { NextResponse, type NextRequest } from 'next/server'

/**
 * Stub auth middleware. See tailwind-checkout/proxy.ts for rationale.
 */
export function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-user-id', 'demo-user')
  return NextResponse.next({ request: { headers: requestHeaders } })
}

export const config = {
  matcher: ['/api/solvapay/:path*'],
}
