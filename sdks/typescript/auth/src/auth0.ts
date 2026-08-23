/**
 * Auth0 server-side auth adapter for Next.js App Router (v4 `@auth0/nextjs-auth0`).
 *
 * Structural typing — no hard dependency on Auth0 packages in `@solvapay/auth`.
 */

import type { AuthAdapter, AuthRequestHandleResult, ServerIdentity } from './adapter'

/** Minimal Auth0 client surface used by the adapter. */
export interface Auth0ClientLike {
  middleware(request: Request): Promise<Response>
  getSession(request: Request): Promise<Auth0Session | null>
}

export type Auth0Session = {
  user?: {
    sub?: string
  }
  tokenSet?: {
    idToken?: string
  }
}

export interface Auth0AuthAdapterConfig {
  auth0: Auth0ClientLike
  /** Route prefix owned by Auth0 (default `/auth`). */
  authRoutePrefix?: string
}

function readPathname(req: Request): string {
  return new URL(req.url).pathname
}

function mergeSetCookies(target: Response, source: Response): void {
  for (const cookie of source.headers.getSetCookie()) {
    target.headers.append('set-cookie', cookie)
  }
}

/**
 * Create a server `AuthAdapter` for Auth0 v4 Next.js SDK.
 *
 * Runs Auth0 middleware on every request (session refresh), short-circuits
 * `/auth/*` routes, and forwards `sub` + optional ID token to downstream handlers.
 */
export function createAuth0AuthAdapter(config: Auth0AuthAdapterConfig): AuthAdapter {
  const { auth0, authRoutePrefix = '/auth' } = config

  const resolveIdentity = async (req: Request): Promise<ServerIdentity | null> => {
    const session = await auth0.getSession(req)
    const userId = session?.user?.sub
    if (!userId) {
      return null
    }

    const idToken = session.tokenSet?.idToken
    if (idToken) {
      return { userId, claimsToken: idToken }
    }

    return { userId }
  }

  return {
    async handleRequest(req: Request): Promise<AuthRequestHandleResult | null> {
      const sessionResponse = await auth0.middleware(req)
      const pathname = readPathname(req)

      if (pathname.startsWith(authRoutePrefix)) {
        return { response: sessionResponse, ownsRequest: true }
      }

      return { sessionResponse, ownsRequest: false }
    },

    async getIdentityFromRequest(req: Request): Promise<ServerIdentity | null> {
      return resolveIdentity(req)
    },

    async getUserIdFromRequest(req: Request): Promise<string | null> {
      const identity = await resolveIdentity(req)
      return identity?.userId ?? null
    },
  }
}

/** @internal exported for middleware cookie merge helper tests */
export { mergeSetCookies }
