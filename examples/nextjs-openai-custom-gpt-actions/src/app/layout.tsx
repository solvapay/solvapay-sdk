'use client'

import { SolvaPayProvider } from '@solvapay/react'
import { createSupabaseAuthAdapter } from '@solvapay/react-supabase'
import { useState, useEffect, useMemo } from 'react'
import { getUserId } from '@/lib/supabase'
import { Auth } from './components/Auth'
import { Inter } from 'next/font/google'
import Link from 'next/link'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  // Initialize auth state
  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const userId = await getUserId()
        setIsAuthenticated(!!userId)
      } catch (error) {
        console.error('Failed to initialize auth:', error)
        setIsAuthenticated(false)
      } finally {
        setIsLoading(false)
      }
    }

    initializeAuth()
  }, [])

  // Create Supabase auth adapter (only if env vars are available)
  const supabaseAdapter = useMemo(() => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseAnonKey) {
      return undefined
    }

    return createSupabaseAuthAdapter({
      supabaseUrl,
      supabaseAnonKey,
    })
  }, [])

  return (
    <html lang="en">
      <head>
        <title>SolvaPay Custom GPT Actions Demo</title>
        <meta name="description" content="Next.js frontend for SolvaPay Custom GPT Actions API" />
      </head>
      <body className={inter.className}>
        {isLoading ? (
          <div className="flex justify-center items-center min-h-screen text-gray-500">
            Initializing...
          </div>
        ) : isAuthenticated ? (
          // Provider with Supabase adapter (if available)
          <SolvaPayProvider
            config={supabaseAdapter ? { auth: { adapter: supabaseAdapter } } : undefined}
          >
            <div className="min-h-screen bg-gray-50">
              <nav className="bg-white shadow-sm border-b">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                  <div className="flex justify-between h-16">
                    <div className="flex items-center">
                      <h1 className="text-xl font-semibold text-gray-900">
                        SolvaPay Custom GPT Actions
                      </h1>
                    </div>
                    <div className="flex items-center space-x-4">
                      <Link
                        href="/"
                        className="text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium"
                      >
                        Home
                      </Link>
                      <Link
                        href="/oauth/authorize"
                        className="text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium"
                      >
                        OAuth Login
                      </Link>
                      <Link
                        href="/checkout"
                        className="text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium"
                      >
                        Checkout
                      </Link>
                      <Link
                        href="/docs"
                        className="text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium"
                      >
                        API Docs
                      </Link>
                    </div>
                  </div>
                </div>
              </nav>
              <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">{children}</main>
            </div>
          </SolvaPayProvider>
        ) : (
          <Auth />
        )}
      </body>
    </html>
  )
}
