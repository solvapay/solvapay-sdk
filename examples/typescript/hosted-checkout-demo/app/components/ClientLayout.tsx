'use client'

import { useState, useEffect } from 'react'
import { getOrCreateCustomerId } from '../lib/customer'
import { demoAuthMode } from '../lib/auth-mode'
import { onAuthStateChange } from '../lib/supabase'
import { Auth } from './Auth'
import { Navigation } from './Navigation'
import { Providers } from './Providers'

export function ClientLayout({ children }: { children: React.ReactNode }) {
  // Anonymous mode has no session to wait for: the customer ref is minted in
  // the browser on first use, so the app is immediately usable.
  const [isAuthenticated, setIsAuthenticated] = useState(demoAuthMode === 'anonymous')
  const [isLoading, setIsLoading] = useState(demoAuthMode === 'supabase')

  // Initialize auth state
  useEffect(() => {
    if (demoAuthMode === 'anonymous') return

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

    // Subscribe to auth state changes
    const {
      data: { subscription },
    } = onAuthStateChange((_event, session) => {
      if (!cancelled) {
        setIsAuthenticated(!!session?.user?.id)
      }
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

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
