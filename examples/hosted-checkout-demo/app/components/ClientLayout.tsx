'use client'

import { useState, useEffect } from 'react'
import { getOrCreateCustomerId } from '../lib/customer'
import { onAuthStateChange } from '../lib/supabase'
import { Auth } from './Auth'
import { Navigation } from './Navigation'
import { Providers } from './Providers'

const isSupabaseConfigured =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder') &&
  !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY !== 'placeholder'

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured)

  useEffect(() => {
    if (!isSupabaseConfigured) return

    let cancelled = false

    const initializeAuth = async () => {
      try {
        const userId = await getOrCreateCustomerId()
        if (!cancelled) {
          setIsAuthenticated(!!userId)
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to initialize auth:', error)
          setIsAuthenticated(false)
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    initializeAuth()

    const {
      data: { subscription },
    } = onAuthStateChange((event, session) => {
      if (!cancelled) {
        setIsAuthenticated(!!session?.user?.id)
      }
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  // Dev mode: no Supabase project configured — skip auth gate and render directly.
  if (!isSupabaseConfigured) {
    return (
      <Providers>
        <Navigation />
        {children}
      </Providers>
    )
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen text-slate-500">
        Initializing...
      </div>
    )
  }

  if (isAuthenticated) {
    return (
      <Providers>
        <Navigation />
        {children}
      </Providers>
    )
  }

  return <Auth />
}
