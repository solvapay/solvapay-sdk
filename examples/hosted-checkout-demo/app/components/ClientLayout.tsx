'use client'

import { useState, useEffect } from 'react'
import { getOrCreateCustomerId } from '../lib/customer'
import { onAuthStateChange } from '../lib/supabase'
import { Auth } from './Auth'
import { Navigation } from './Navigation'
import { Providers } from './Providers'

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  // Initialize auth state
  useEffect(() => {
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

    // Purchase to auth state changes
    const {
      data: { purchase },
    } = onAuthStateChange((event, session) => {
      if (!cancelled) {
        setIsAuthenticated(!!session?.user?.id)
      }
    })

    return () => {
      cancelled = true
      purchase.unsubscribe()
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
