'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

export default function Home() {
  const [baseUrl, setBaseUrl] = useState('')
  const [apiUrl, setApiUrl] = useState('')
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [copiedAuthUrl, setCopiedAuthUrl] = useState(false)
  const [copiedTokenUrl, setCopiedTokenUrl] = useState(false)
  const [user, setUser] = useState<{ email?: string } | null>(null)
  const [loadingUser, setLoadingUser] = useState(true)

  useEffect(() => {
    // Fetch public URL configuration
    fetch('/api/config/url')
      .then((res) => res.json())
      .then((data) => {
        const origin = data.url || window.location.origin
        setBaseUrl(origin)
        setApiUrl(`${origin}/api/docs/json`)
      })
      .catch(() => {
        const origin = window.location.origin
        setBaseUrl(origin)
        setApiUrl(`${origin}/api/docs/json`)
      })

    // Check if user is logged in
    fetch('/api/me')
      .then((res) => {
        if (res.ok) return res.json()
        return null
      })
      .then((data) => {
        if (data && data.authenticated) {
          setUser(data.user)
        } else {
          setUser(null)
        }
        setLoadingUser(false)
      })
      .catch(() => {
        setUser(null)
        setLoadingUser(false)
      })
  }, [])

  const copyToClipboard = (text: string, setCopiedState: (val: boolean) => void) => {
    navigator.clipboard.writeText(text)
    setCopiedState(true)
    setTimeout(() => setCopiedState(false), 2000)
  }

  const handleSignOut = async () => {
    try {
      // Sign out from Supabase (clears cookies)
      await fetch('/api/auth/signout', { method: 'POST' })
      
      // Also try client-side sign out if Supabase client is available
      try {
        const { supabase } = await import('@/lib/supabase')
        await supabase.auth.signOut()
      } catch (e) {
        console.warn('Client-side sign out failed', e)
      }

      // Reload to clear state
      window.location.reload()
    } catch (error) {
      console.error('Sign out failed:', error)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-8 md:p-24 max-w-4xl mx-auto">
      <div className="absolute top-4 right-4 flex items-center gap-4">
        {!loadingUser && (
          user ? (
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-600">Signed in as <strong>{user.email}</strong></span>
              <button 
                onClick={handleSignOut}
                className="text-sm font-medium text-red-600 hover:text-red-800 transition-colors"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <Link 
              href="/login" 
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              Log In
            </Link>
          )
        )}
      </div>

      <h1 className="text-4xl font-bold mb-4 text-center">SolvaPay Custom GPT Actions API</h1>
      <p className="text-xl mb-12 text-center text-gray-600 max-w-2xl">
        This is a backend API for OpenAI Custom GPT Actions.
        It provides a Tasks API secured by Supabase Auth and monetized with SolvaPay.
      </p>

      <div className="grid gap-8 w-full mb-12">
        {/* OpenAPI Spec Section */}
        <div className="w-full bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
          <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900">1. OpenAPI Specification URL</h2>
            <p className="text-sm text-gray-500">Import this URL into your Custom GPT Action</p>
          </div>
          <div className="p-6 flex flex-col md:flex-row gap-4 items-center">
            <code className="flex-1 p-4 bg-gray-100 rounded-lg text-sm font-mono break-all w-full">
              {apiUrl || 'Loading...'}
            </code>
            <button
              onClick={() => copyToClipboard(apiUrl, setCopiedUrl)}
              className="px-6 py-3 bg-black text-white rounded-lg hover:bg-gray-800 transition-colors whitespace-nowrap font-medium min-w-[120px]"
            >
              {copiedUrl ? 'Copied!' : 'Copy URL'}
            </button>
          </div>
        </div>

        {/* OAuth Configuration Section */}
        <div className="w-full bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
          <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900">2. OAuth Configuration</h2>
            <p className="text-sm text-gray-500">Use these details in the "Authentication" settings of your Custom GPT</p>
          </div>
          <div className="p-6 space-y-6">
            {/* Authorization URL */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Authorization URL</label>
              <div className="flex flex-col md:flex-row gap-4 items-center">
                <code className="flex-1 p-3 bg-gray-100 rounded-lg text-sm font-mono break-all w-full">
                  {baseUrl ? `${baseUrl}/api/oauth/authorize` : 'Loading...'}
                </code>
                <button
                  onClick={() => copyToClipboard(`${baseUrl}/api/oauth/authorize`, setCopiedAuthUrl)}
                  className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors whitespace-nowrap text-sm font-medium min-w-[100px]"
                >
                  {copiedAuthUrl ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>

            {/* Token URL */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Token URL</label>
              <div className="flex flex-col md:flex-row gap-4 items-center">
                <code className="flex-1 p-3 bg-gray-100 rounded-lg text-sm font-mono break-all w-full">
                  {baseUrl ? `${baseUrl}/api/oauth/token` : 'Loading...'}
                </code>
                <button
                  onClick={() => copyToClipboard(`${baseUrl}/api/oauth/token`, setCopiedTokenUrl)}
                  className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors whitespace-nowrap text-sm font-medium min-w-[100px]"
                >
                  {copiedTokenUrl ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>

            {/* Other Details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Scope</label>
                <code className="block w-full p-3 bg-gray-100 rounded-lg text-sm font-mono">
                  openid email profile
                </code>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Token Exchange Method</label>
                <div className="block w-full p-3 bg-gray-100 rounded-lg text-sm text-gray-600">
                  Default (POST request)
                </div>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 text-sm text-blue-800">
              <strong>Note:</strong> For <strong>Client ID</strong> and <strong>Client Secret</strong>, use the values you configured in your <code>.env.local</code> file (<code>OAUTH_CLIENT_ID</code> and <code>OAUTH_CLIENT_SECRET</code>).
            </div>
          </div>
        </div>
      </div>

      <div className="w-full max-w-2xl space-y-6">
        <h2 className="text-2xl font-bold text-gray-900">How to Use</h2>
        
        <div className="space-y-4">
          <div className="flex gap-4">
            <div className="flex-shrink-0 w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold">1</div>
            <div>
              <h3 className="font-semibold text-gray-900">Create a Custom GPT</h3>
              <p className="text-gray-600">Go to <a href="https://chat.openai.com/create" target="_blank" className="text-blue-600 hover:underline">ChatGPT</a> and create a new GPT.</p>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex-shrink-0 w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold">2</div>
            <div>
              <h3 className="font-semibold text-gray-900">Add Action</h3>
              <p className="text-gray-600">In the &quot;Configure&quot; tab, click &quot;Create new action&quot; and select &quot;Import from URL&quot;.</p>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex-shrink-0 w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold">3</div>
            <div>
              <h3 className="font-semibold text-gray-900">Paste URL</h3>
              <p className="text-gray-600">Paste the OpenAPI URL from section 1 above.</p>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex-shrink-0 w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold">4</div>
            <div>
              <h3 className="font-semibold text-gray-900">Configure Auth</h3>
              <p className="text-gray-600">Set Authentication Type to <strong>OAuth</strong> and copy the details from section 2 above.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
