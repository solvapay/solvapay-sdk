'use client'

import {
  SolvaPayProvider,
  createAnonymousAuthAdapter,
  getOrCreateAnonymousCustomerRef,
} from '@solvapay/react'
import { createSupabaseAuthAdapter } from '@solvapay/react-supabase'
import { useMemo } from 'react'
import { demoAuthMode } from '../lib/auth-mode'
import { supabase } from '../lib/supabase'

export function Providers({ children }: { children: React.ReactNode }) {
  const config = useMemo(() => {
    if (demoAuthMode === 'anonymous') {
      // The ref is persisted in the browser, so it is stable across reloads.
      // `proxy.ts` promotes the header to `x-user-id` for the API routes.
      const customerRef = getOrCreateAnonymousCustomerRef()
      return {
        auth: { adapter: createAnonymousAuthAdapter(customerRef) },
        headers: { 'x-customer-ref': customerRef },
      }
    }

    return { auth: { adapter: createSupabaseAuthAdapter({ client: supabase }) } }
  }, [])

  return <SolvaPayProvider config={config}>{children}</SolvaPayProvider>
}
