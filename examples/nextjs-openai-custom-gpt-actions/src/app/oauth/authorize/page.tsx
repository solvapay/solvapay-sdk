'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

function OAuthAuthorizeForm() {
  const [email, setEmail] = useState('demo@example.com')
  const [password, setPassword] = useState('demo123')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const searchParams = useSearchParams()

  useEffect(() => {
    // Hide the navigation immediately for overlay experience
    const style = document.createElement('style')
    style.textContent = `
      body > div:first-child > nav,
      body > div:first-child > header,
      nav, header, .min-h-screen > nav {
        display: none !important;
      }
      body > div:first-child > main {
        padding: 0 !important;
        margin: 0 !important;
        max-width: none !important;
      }
      body {
        background: #fafafa !important;
      }
    `
    document.head.appendChild(style)

    const redirectUri = searchParams.get('redirect_uri')
    console.log('🔍 [OAUTH DEBUG] OAuth params:', {
      client_id: searchParams.get('client_id'),
      redirect_uri: redirectUri,
      response_type: searchParams.get('response_type'),
      scope: searchParams.get('scope'),
      state: searchParams.get('state')
    })
    
    if (!redirectUri) {
      console.warn('⚠️ [OAUTH WARNING] No redirect_uri found in URL parameters!')
      setError('Missing redirect_uri parameter. Please start OAuth flow from ChatGPT.')
    }

    return () => {
      document.head.removeChild(style)
    }
  }, [searchParams])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    // For OAuth redirects, we need to let the browser handle the form submission
    // instead of using fetch() to avoid CORS issues with external redirects
    const form = e.target as HTMLFormElement
    form.submit()
  }

  return (
    <div className="fixed inset-0 bg-gray-50 z-50 overflow-y-auto">
      <div className="max-w-md mx-auto py-10 px-5 relative font-sans">
        <button 
          className="absolute top-5 right-5 bg-transparent border-none text-gray-400 cursor-pointer p-2 rounded text-xl leading-none hover:text-gray-600 transition-colors"
          onClick={() => {
            const redirectUri = searchParams.get('redirect_uri');
            if (redirectUri && redirectUri.includes('chat.openai.com')) {
              window.close();
            } else {
              window.history.back();
            }
          }}
          title="Close"
        >
          ×
        </button>
        
        <div className="text-center mb-10 mt-5">
          <h1 className="text-3xl font-semibold text-gray-900 mb-2">
            OAuth Login
          </h1>
          <p className="text-base text-gray-600">
            Sign in to authorize the application
          </p>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-8">
          {/* OAuth client and redirect info */}
          <div className="mb-6 pb-6 border-b border-gray-100">
            <div className="text-sm text-gray-600 mb-2">
              <strong>Client:</strong> {searchParams.get('client_id') || 'solvapay-demo-client'}
            </div>
            {searchParams.get('redirect_uri') && (
              <div className="text-sm text-gray-600 break-all">
                <strong>Redirect:</strong> {searchParams.get('redirect_uri')}
              </div>
            )}
          </div>

          <form className="space-y-6" action="/api/oauth/authorize" method="POST" onSubmit={handleSubmit}>
            {/* Hidden OAuth parameters */}
            <input type="hidden" name="response_type" value={searchParams.get('response_type') || 'code'} />
            <input type="hidden" name="client_id" value={searchParams.get('client_id') || 'demo-client'} />
            <input type="hidden" name="redirect_uri" value={searchParams.get('redirect_uri') || ''} />
            <input type="hidden" name="scope" value={searchParams.get('scope') || 'openid profile email'} />
            <input type="hidden" name="state" value={searchParams.get('state') || 'demo-state'} />
            
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                Email:
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-md text-base placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                placeholder="demo@example.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                Password:
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-md text-base placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                placeholder="demo123"
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-md text-sm">{error}</div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white border-none py-4 rounded-md text-base font-medium cursor-pointer hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <div className="inline-flex items-center">
                  <div className="w-4 h-4 border-2 border-transparent border-t-current rounded-full animate-spin mr-2"></div>
                  Signing in...
                </div>
              ) : (
                'Login'
              )}
            </button>
          </form>
        </div>

        <div className="bg-gray-100 border border-gray-300 text-gray-600 p-4 rounded-md text-sm mt-6">
          <strong>Demo Mode:</strong> Use demo@example.com / demo123 or test@example.com / test123 to sign in.
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
          <div className="bg-white border border-gray-200 rounded-lg p-8">
            <div className="text-center text-gray-600">
              <div className="w-6 h-6 border-2 border-transparent border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
              Loading authorization form...
            </div>
          </div>
        </div>
      </div>
    }>
      <OAuthAuthorizeForm />
    </Suspense>
  )
}
