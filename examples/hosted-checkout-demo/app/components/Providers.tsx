'use client'

import { SolvaPayProvider } from '@solvapay/react'
import { createSupabaseAuthAdapter } from '@solvapay/react-supabase'
import { useMemo } from 'react'
import { supabase } from '../lib/supabase'

export function Providers({ children }: { children: React.ReactNode }) {
  const supabaseAdapter = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !key || url.includes('placeholder') || key === 'placeholder') {
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
