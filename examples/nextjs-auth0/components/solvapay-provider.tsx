'use client'

import { useMemo } from 'react'
import { useUser } from '@auth0/nextjs-auth0'
import { SolvaPayProvider, type AuthAdapter } from '@solvapay/react'

/**
 * Wraps the app in `SolvaPayProvider` and bridges Auth0 to the SDK.
 *
 * Auth0 keeps the session in an httpOnly cookie, so the browser can't read a
 * token directly — `useUser()` fetches `/auth/profile` for the current user.
 * Same-origin requests to our API routes carry the session cookie
 * automatically, and `proxy.ts` turns that into the `x-user-id` the server SDK
 * needs. The client adapter therefore only has to report *whether* a user is
 * signed in (any non-null `getToken` flips the provider to authenticated) and
 * expose the stable user id used as the purchase-cache key.
 */
export function SolvaPayClientProvider({ children }: { children: React.ReactNode }) {
  const { user } = useUser()

  const adapter = useMemo<AuthAdapter>(
    () => ({
      // Sentinel — the real credential is the Auth0 session cookie sent with
      // each same-origin request. Returning a non-null value here marks the
      // user authenticated so the SDK starts checking purchases.
      getToken: async () => (user?.sub ? 'auth0-session' : null),
      getUserId: async () => user?.sub ?? null,
    }),
    [user?.sub],
  )

  return (
    <SolvaPayProvider config={{ auth: { adapter } }}>{children}</SolvaPayProvider>
  )
}
