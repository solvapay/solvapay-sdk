/**
 * Auth0 + SolvaPay identity bridge (server-side only).
 *
 * `createAuth0AuthMiddleware` (from `@solvapay/next/middleware` + `@solvapay/auth/auth0`):
 *
 * 1. Mounts Auth0 v4 routes: `/auth/login`, `/auth/callback`, `/auth/logout`.
 * 2. Reads the Auth0 session from the httpOnly cookie on every matched request.
 * 3. Forwards `x-user-id = session.user.sub` to downstream route handlers — this is
 *    SolvaPay's stable `externalRef` / customer reference.
 * 4. Optionally forwards `Authorization: Bearer <id_token>` server-side only, so
 *    `@solvapay/next` route wrappers can seed email/name on first customer create.
 *
 * Security contract:
 * - IdP **access tokens** never reach SolvaPay APIs (validate at your edge only).
 * - IdP **ID tokens** may be forwarded here in the proxy only — never from the browser.
 * - `SOLVAPAY_SECRET_KEY` stays server-only; billing calls use `sk_*`, not IdP bearer tokens.
 * - SolvaPay keys on the stable Auth0 `sub`, so access-token expiry does not break linkage.
 *
 * The client-side bridge in `components/solvapay-provider.tsx` only reports whether a
 * user is signed in — the real identity handoff for API routes happens here.
 */
import { createAuth0AuthMiddleware } from '@solvapay/next/middleware'

import { auth0 } from './lib/auth0'

export const proxy = createAuth0AuthMiddleware({ auth0 })

export const config = {
  // Run on all routes except static assets and metadata files.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)'],
}
