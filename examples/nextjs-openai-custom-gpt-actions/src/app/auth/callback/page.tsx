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
        // Set cookies for server-side middleware compatibility
        // We match the names used in our middleware/authorize route
        const maxAge = 60 * 60 * 24 * 30 // 30 days
        
        document.cookie = `sb-access-token=${session.access_token}; path=/; max-age=${maxAge}; SameSite=Lax; ${window.location.protocol === 'https:' ? 'Secure' : ''}`
        document.cookie = `sb-refresh-token=${session.refresh_token}; path=/; max-age=${maxAge}; SameSite=Lax; ${window.location.protocol === 'https:' ? 'Secure' : ''}`

        // Force hard navigation to ensure cookies are sent and API route is hit correctly
        window.location.href = next
      } else {
        // No session found yet, listen for changes
        // This handles the case where the hash parsing happens slightly after mount
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
          if (event === 'SIGNED_IN' && session) {
             const maxAge = 60 * 60 * 24 * 30 // 30 days
        
            document.cookie = `sb-access-token=${session.access_token}; path=/; max-age=${maxAge}; SameSite=Lax; ${window.location.protocol === 'https:' ? 'Secure' : ''}`
            document.cookie = `sb-refresh-token=${session.refresh_token}; path=/; max-age=${maxAge}; SameSite=Lax; ${window.location.protocol === 'https:' ? 'Secure' : ''}`
            
            // Force hard navigation to ensure cookies are sent and API route is hit correctly
            window.location.href = next
          }
        })

        return () => {
          subscription.unsubscribe()
        }
      }
    }

    handleAuthCallback()
  }, [router, next])

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

