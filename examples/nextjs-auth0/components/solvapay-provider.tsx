'use client'

import { useMemo } from 'react'
import { useUser } from '@auth0/nextjs-auth0'
import { SolvaPayProvider } from '@solvapay/react'
import { createAuth0ClientAuthAdapter } from '@solvapay/react/auth0'

/**
 * Client-side SolvaPay auth adapter — UI/session awareness only.
 *
 * `createAuth0ClientAuthAdapter` reports signed-in state via Auth0 `user.sub`.
 * It does **not** send Auth0 tokens to SolvaPay; the client uses a sentinel
 * auth pattern so React hooks know when to show paywall/checkout UI.
 *
 * The production identity bridge for API routes and billing is server-side in
 * `proxy.ts`: middleware reads the httpOnly Auth0 session and sets `x-user-id`.
 * Keep those two layers separate — never put IdP bearer tokens in the browser
 * adapter or localStorage.
 *
 * `useMemo` on `user?.sub` avoids recreating the adapter when unrelated user
 * fields change (email, picture, etc.).
 */
export function SolvaPayClientProvider({ children }: { children: React.ReactNode }) {
  const { user } = useUser()

  const adapter = useMemo(
    () => createAuth0ClientAuthAdapter({ userId: user?.sub }),
    [user?.sub],
  )

  return (
    <SolvaPayProvider config={{ auth: { adapter } }}>{children}</SolvaPayProvider>
  )
}
