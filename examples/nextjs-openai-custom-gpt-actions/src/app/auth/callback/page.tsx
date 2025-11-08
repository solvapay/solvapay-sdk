'use client'

import { useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

// Force dynamic rendering to prevent build-time errors
export const dynamic = 'force-dynamic'

/**
 * Supabase Auth Callback Content
 *
 * Handles the OAuth callback from Supabase after Google sign-in.
 * Supabase automatically exchanges the code for a session.
 * After session is established, redirect to home page.
 */
function SupabaseAuthCallbackContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Check for error in URL params
        const error = searchParams.get('error')
        const errorDescription = searchParams.get('error_description')

        if (error) {
          console.error('Supabase auth error:', error, errorDescription)
          router.push('/?error=' + encodeURIComponent(error || 'auth_error'))
          return
        }

        // Supabase automatically exchanges the code for a session when the callback URL is accessed
        // Wait a moment for Supabase to process the callback, then check for session
        await new Promise(resolve => setTimeout(resolve, 500))

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession()

        if (sessionError || !session) {
          console.error('Session error:', sessionError)
          router.push('/?error=' + encodeURIComponent('session_error'))
          return
        }

        // Redirect to home page - layout will handle showing authenticated content
        router.push('/')
      } catch (err) {
        console.error('Callback error:', err)
        router.push('/?error=' + encodeURIComponent('callback_error'))
      }
    }

    handleCallback()
  }, [router, searchParams])

  return (
    <div className="flex justify-center items-center min-h-screen px-4">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">Completing sign in...</p>
      </div>
    </div>
  )
}

/**
 * Supabase Auth Callback Page
 */
export default function SupabaseAuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center items-center min-h-screen px-4">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading...</p>
          </div>
        </div>
      }
    >
      <SupabaseAuthCallbackContent />
    </Suspense>
  )
}
