'use client'

import { SolvaPayProvider } from '@solvapay/react'
import { createSupabaseAuthAdapter } from '@solvapay/react-supabase'
import { useMemo } from 'react'
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
  const supabaseAdapter = useMemo(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      return undefined
    }
    return createSupabaseAuthAdapter({ client: supabase })
  }, [])

  return (
    <SolvaPayProvider
      config={{
        ...(supabaseAdapter ? { auth: { adapter: supabaseAdapter } } : {}),
        // locale: 'sv-SE',
        // copy: svSECopy,
      }}
    >
      {children}
    </SolvaPayProvider>
  )
}
