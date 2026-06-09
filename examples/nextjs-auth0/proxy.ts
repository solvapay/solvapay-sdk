import { NextRequest, NextResponse } from 'next/server'

import { auth0 } from './lib/auth0'

/**
 * Auth0 session handling + SolvaPay identity bridge.
 *
 * `auth0.middleware` mounts the `/auth/*` routes and refreshes the session.
 * For every other request we read the session and forward two things to
 * downstream SolvaPay route handlers:
 *
 *  - `x-user-id` — the Auth0 `sub`. The SDK uses it as the customer reference
 *    (see `getAuthenticatedUserCore` / the Next adapter's `getCustomerRef`).
 *  - `Authorization: Bearer <id_token>` — the Auth0 ID token, a JWT carrying
 *    the user's `email` and `name`. The SDK decodes it to populate those
 *    fields when it first creates the SolvaPay customer; without a real email
 *    it would fall back to an invalid `auth0|...@auto-created.local` address
 *    (the `sub` contains a `|`) and customer creation would 400.
 *
 * Both headers are set server-side here, so each SolvaPay route handler stays
 * a one-liner and the customer ref is always the authenticated Auth0 `sub`.
 */
export async function proxy(request: NextRequest) {
  const authRes = await auth0.middleware(request)

  // Let Auth0 own its own routes (/auth/login, /auth/callback, /auth/logout,
  // /auth/profile, ...).
  if (request.nextUrl.pathname.startsWith('/auth')) {
    return authRes
  }

  const session = await auth0.getSession(request)
  if (!session?.user?.sub) {
    return authRes
  }

  // Forward the authenticated identity to downstream route handlers while
  // preserving any session cookies Auth0 refreshed during middleware.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-user-id', session.user.sub)

  // Forward the ID token so the SDK can read the real email / name when it
  // creates the customer. Optional in the session type, so guard it.
  const idToken = session.tokenSet?.idToken
  if (idToken) {
    requestHeaders.set('authorization', `Bearer ${idToken}`)
  }

  const res = NextResponse.next({ request: { headers: requestHeaders } })
  for (const cookie of authRes.headers.getSetCookie()) {
    res.headers.append('set-cookie', cookie)
  }
  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)'],
}
