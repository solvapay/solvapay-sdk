import { Auth0Client } from '@auth0/nextjs-auth0/server'

/**
 * Shared Auth0 v4 server client for this app.
 *
 * Reads from env: `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`,
 * `AUTH0_SECRET`, `APP_BASE_URL` (see `.env.example`).
 *
 * Requires an Auth0 Dashboard **Regular Web Application** (not SPA / Native) so
 * the session is stored in an httpOnly cookie and `/auth/login|callback|logout`
 * work server-side via `proxy.ts`.
 *
 * IdP access-token TTL at your edge is irrelevant to SolvaPay: we never send access
 * tokens to SolvaPay. Billing identity is the stable Auth0 `sub`, forwarded as
 * `x-user-id` by the middleware after each session read.
 */
export const auth0 = new Auth0Client()
