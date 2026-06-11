'use client'

import { useMemo } from 'react'
import { useUser } from '@auth0/nextjs-auth0'
import { SolvaPayProvider } from '@solvapay/react'
import { createAuth0ClientAuthAdapter } from '@solvapay/react/auth0'

/**
 * Wraps the app in `SolvaPayProvider` and bridges Auth0 to the SDK via
 * `@solvapay/react/auth0`. The server-side session is forwarded in `proxy.ts`
 * by `@solvapay/auth/auth0` + `@solvapay/next/middleware`.
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
