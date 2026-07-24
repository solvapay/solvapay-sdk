'use client'

import { SolvaPayProvider } from '@solvapay/react'
import { createSupabaseAuthAdapter } from '@solvapay/react-supabase'
import { useMemo } from 'react'
import { supabase } from '../lib/supabase'

export function Providers({ children }: { children: React.ReactNode }) {
  const supabaseAdapter = useMemo(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      return undefined
    }
    return createSupabaseAuthAdapter({ client: supabase })
  }, [])

  return (
    <SolvaPayProvider config={supabaseAdapter ? { auth: { adapter: supabaseAdapter } } : undefined}>
      {children}
    </SolvaPayProvider>
  )
}
