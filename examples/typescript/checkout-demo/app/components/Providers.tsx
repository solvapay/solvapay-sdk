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

// --- Optional: ship your own copy bundle for non-English locales -------------
// The SDK includes English out of the box. To override copy, pass a partial
// `copy` bundle and a matching `locale` to SolvaPayProvider. Uncomment to try.
//
// import type { PartialSolvaPayCopy } from '@solvapay/react'
//
// const svSECopy: PartialSolvaPayCopy = {
//   cta: { payNow: 'Betala nu', subscribe: 'Prenumerera' },
//   planSelector: { heading: 'Välj prissättning', continueButton: 'Fortsätt' },
//   activationFlow: { heading: 'Bekräfta din plan', activateButton: 'Aktivera' },
// }
// -----------------------------------------------------------------------------

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

    return {
      auth: { adapter: createSupabaseAuthAdapter({ client: supabase }) },
      // locale: 'sv-SE',
      // copy: svSECopy,
    }
  }, [])

  return <SolvaPayProvider config={config}>{children}</SolvaPayProvider>
}
