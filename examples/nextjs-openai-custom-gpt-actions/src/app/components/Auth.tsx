'use client'

import { useState, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { signUp, signIn, signInWithGoogle, getAccessToken } from '@/lib/supabase'

interface AuthProps {
  initialView?: 'signin' | 'signup'
}

export function Auth({ initialView = 'signin' }: AuthProps) {
  const [isSignUp, setIsSignUp] = useState(initialView === 'signup')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [signUpSuccess, setSignUpSuccess] = useState(false)
  
  const searchParams = useSearchParams()
  const router = useRouter()
  const redirectTo = searchParams.get('redirect_to')
  const forceLogin = searchParams.get('force_login') === 'true'

  // Update isSignUp when initialView changes (if component is remounted or prop changes)
  useEffect(() => {
    setIsSignUp(initialView === 'signup')
  }, [initialView])

  // Handle force login (sign out existing user)
  useEffect(() => {
    const checkSession = async () => {
      if (forceLogin) {
        try {
          await import('@/lib/supabase').then(m => m.supabase.auth.signOut())
        } catch {
          // Ignore errors during signout
        }
      }
    }
    
    checkSession()
  }, [forceLogin])

  const handleGoogleSignIn = async () => {
    setError(null)
    setIsLoading(true)

    try {
      // If we have a redirect_to param, we should include it in the callback URL
      // so the auth callback handler knows where to send the user next
      const origin = window.location.origin
      let callbackUrl = `${origin}/auth/callback`
      
      if (redirectTo) {
        callbackUrl += `?next=${encodeURIComponent(redirectTo)}`
      }

      const { error: googleError } = await signInWithGoogle(callbackUrl)
      if (googleError) throw googleError
      // OAuth redirect will happen automatically
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed')
      setIsLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsLoading(true)
    setSignUpSuccess(false)

    let shouldRedirect = false

    try {
      if (isSignUp) {
        const { data, error: signUpError } = await signUp(email, password)
        if (signUpError) throw signUpError

        if (data.session) {
          // User signed in immediately (no email confirm required or auto-confirmed)
          // Sync customer in SolvaPay
          try {
            const accessToken = await getAccessToken()
            if (accessToken) {
              await fetch('/api/sync-customer', {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
              }).catch(() => {
                console.warn('Failed to sync customer after signup')
              })
            }
          } catch {
            // Silent failure
          }
          
          // Redirect if needed
          shouldRedirect = true
          if (redirectTo) {
            window.location.href = redirectTo
          } else {
            // Go to home or dashboard
            router.push('/')
          }
          return
        } else {
          setSignUpSuccess(true)
        }
      } else {
        const { error: signInError } = await signIn(email, password)
        if (signInError) throw signInError
        
        // Successful sign in
        // Sync customer with SolvaPay using externalRef (Supabase user ID) to ensure they are linked
        try {
          const { data: { session } } = await import('@/lib/supabase').then(m => m.supabase.auth.getSession())
          const accessToken = session?.access_token
          
          if (accessToken) {
            await fetch('/api/sync-customer', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            }).catch(() => {
              console.warn('Failed to sync customer after signin')
            })
          }
        } catch {
          // Silent failure
        }

        if (redirectTo) {
          shouldRedirect = true
          window.location.href = redirectTo
        } else {
          router.refresh()
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      // Only stop loading if we're not redirecting
      if (!shouldRedirect) {
        setIsLoading(false)
      }
    }
  }

  return (
    <div className="flex justify-center items-center min-h-screen px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow-lg border border-gray-200 p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            {isSignUp ? 'Create Account' : 'Sign In'}
          </h2>
          <p className="text-sm text-gray-600 mb-6">
            {isSignUp ? 'Create a new account to continue' : 'Sign in to your account'}
          </p>

          <div className="space-y-4">
            {/* Google Sign-in Button */}
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-3 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Sign in with Google
            </button>

            {/* Divider */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">Or continue with email</span>
              </div>
            </div>

            {/* Email/Password Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  disabled={isLoading}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  disabled={isLoading}
                  minLength={6}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                />
              </div>

              {error && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
                  {error}
                </div>
              )}

              {signUpSuccess && (
                <div className="text-sm text-blue-600 bg-blue-50 border border-blue-200 rounded-lg p-3">
                  Account created! Please check your email to confirm your account, then sign in.
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-blue-600 text-white py-2.5 px-4 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center"
              >
              {isLoading ? (
                <>
                  <svg className="animate-spin mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                  Processing...
                </>
              ) : isSignUp ? (
                'Sign Up'
              ) : (
                'Sign In'
              )}
              </button>
            </form>

            <div className="text-center">
              <button
                type="button"
                onClick={() => {
                  setIsSignUp(!isSignUp)
                  setError(null)
                  setSignUpSuccess(false)
                }}
                className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
                disabled={isLoading}
              >
                {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
