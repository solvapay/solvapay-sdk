'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function AuthCallbackPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams.get('next') || '/'
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handleAuthCallback = async () => {
      // Supabase client automatically parses the hash fragment
      const { data: { session }, error } = await supabase.auth.getSession()

      if (error) {
        console.error('Auth callback error:', error)
        setError(error.message)
        return
      }

      if (session) {
        // Set cookies via server-side endpoint for better reliability
        try {
          const response = await fetch('/api/auth/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              accessToken: session.access_token,
              refreshToken: session.refresh_token,
            }),
          })

          if (!response.ok) {
            throw new Error('Failed to set session cookies')
          }

          // Sync customer with SolvaPay (idempotent - safe to call on every login)
          // This ensures customer is created/updated in SolvaPay
          // Uses Bearer token directly since cookies may not propagate immediately
          try {
            const syncResponse = await fetch('/api/sync-customer', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${session.access_token}`,
              },
            })
            
            if (!syncResponse.ok) {
              // Log but don't block the flow
              console.warn('Customer sync warning (non-blocking):', await syncResponse.text())
            }
          } catch (syncError) {
            // Don't block the auth flow if sync fails - it can retry on next login
            console.warn('Failed to sync customer (will retry on next login):', syncError)
          }

          // Navigate to destination
          window.location.href = next
        } catch (err: any) {
          console.error('Failed to set session:', err)
          setError(err.message || 'Failed to complete sign in')
        }
      } else {
        // No session found yet, listen for changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
          if (event === 'SIGNED_IN' && session) {
            try {
              const response = await fetch('/api/auth/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  accessToken: session.access_token,
                  refreshToken: session.refresh_token,
                }),
              })

              if (!response.ok) {
                throw new Error('Failed to set session cookies')
              }

              // Sync customer with SolvaPay (idempotent)
              try {
                const syncResponse = await fetch('/api/sync-customer', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${session.access_token}`,
                  },
                })
                
                if (!syncResponse.ok) {
                  console.warn('Customer sync warning (non-blocking):', await syncResponse.text())
                }
              } catch (syncError) {
                console.warn('Failed to sync customer (will retry on next login):', syncError)
              }

              window.location.href = next
            } catch (err: any) {
              console.error('Failed to set session:', err)
              setError(err.message || 'Failed to complete sign in')
            }
          }
        })

        return () => {
          subscription.unsubscribe()
        }
      }
    }

    handleAuthCallback()
  }, [next])

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4">
        <div className="bg-red-50 text-red-700 p-4 rounded-lg max-w-md text-center">
          <h3 className="font-bold mb-2">Authentication Error</h3>
          <p>{error}</p>
          <button 
            onClick={() => router.push('/login')}
            className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
          >
            Back to Login
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50">
      <div className="flex flex-col items-center space-y-4">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-gray-600 font-medium">Completing sign in...</p>
      </div>
    </div>
  )
}
