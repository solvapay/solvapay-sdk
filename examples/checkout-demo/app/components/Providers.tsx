'use client'

import { SolvaPayProvider } from '@solvapay/react'
import { createSupabaseAuthAdapter } from '@solvapay/react-supabase'
import { useMemo } from 'react'

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
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!supabaseUrl || !supabaseAnonKey) return undefined
    return createSupabaseAuthAdapter({ supabaseUrl, supabaseAnonKey })
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
