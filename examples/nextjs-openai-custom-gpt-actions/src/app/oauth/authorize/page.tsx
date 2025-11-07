'use client'

import { useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

/**
 * OAuth Authorize Page
 * 
 * Redirects to the API route that will initiate Supabase OAuth flow.
 * This page is kept for compatibility but immediately redirects.
 */
function OAuthAuthorizeRedirect() {
  const searchParams = useSearchParams()

  useEffect(() => {
    // Build the OAuth authorize URL with all params
    const params = new URLSearchParams()
    const clientId = searchParams.get('client_id')
    const redirectUri = searchParams.get('redirect_uri')
    const responseType = searchParams.get('response_type')
    const scope = searchParams.get('scope')
    const state = searchParams.get('state')

    if (clientId) params.set('client_id', clientId)
    if (redirectUri) params.set('redirect_uri', redirectUri)
    if (responseType) params.set('response_type', responseType)
    if (scope) params.set('scope', scope)
    if (state) params.set('state', state)

    // Redirect to API route that will handle Supabase OAuth
    const apiUrl = `/api/oauth/authorize?${params.toString()}`
    window.location.href = apiUrl
  }, [searchParams])

  return (
    <div className="fixed inset-0 bg-gray-50 z-50 overflow-y-auto">
      <div className="max-w-md mx-auto py-10 px-5 relative font-sans">
        <div className="text-center mb-10 mt-5">
          <h1 className="text-3xl font-semibold text-gray-900 mb-2">
            Redirecting...
          </h1>
          <p className="text-base text-gray-600">
            Initiating OAuth flow with Supabase
          </p>
          <div className="mt-6">
            <div className="w-6 h-6 border-2 border-transparent border-t-blue-600 rounded-full animate-spin mx-auto"></div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function OAuthAuthorizePage() {
  return (
    <Suspense fallback={
      <div className="fixed inset-0 bg-gray-50 z-50 overflow-y-auto">
        <div className="max-w-md mx-auto py-10 px-5 relative font-sans">
          <div className="text-center mb-10 mt-5">
            <h1 className="text-3xl font-semibold text-gray-900 mb-2">
              OAuth Login
            </h1>
            <p className="text-base text-gray-600">
              Loading...
            </p>
          </div>
        </div>
      </div>
    }>
      <OAuthAuthorizeRedirect />
    </Suspense>
  )
}
