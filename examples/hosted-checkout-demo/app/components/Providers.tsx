'use client'

import { SolvaPayProvider } from '@solvapay/react'
import { createSupabaseAuthAdapter } from '@solvapay/react-supabase'
import { useMemo } from 'react'

export function Providers({ children }: { children: React.ReactNode }) {
  const supabaseAdapter = useMemo(() => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!supabaseUrl || !supabaseAnonKey) return undefined
    return createSupabaseAuthAdapter({ supabaseUrl, supabaseAnonKey })
  }, [])

  return (
    <SolvaPayProvider config={supabaseAdapter ? { auth: { adapter: supabaseAdapter } } : undefined}>
      {children}
    </SolvaPayProvider>
  )
}
