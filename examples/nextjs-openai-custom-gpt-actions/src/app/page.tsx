'use client'

import { useState, useEffect } from 'react'

export default function Home() {
  const [apiUrl, setApiUrl] = useState('')
  const [solvaPayConsoleUrl, setSolvaPayConsoleUrl] = useState('http://localhost:3000')
  
  const [copiedUrl, setCopiedUrl] = useState(false)
  
  const [user, setUser] = useState<{ email?: string; name?: string } | null>(null)
  const [loadingUser, setLoadingUser] = useState(true)

  useEffect(() => {
    const fallbackOrigin = window.location.origin
    setApiUrl(`${fallbackOrigin}/api/docs/json`)

    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 5000)

    // Fetch configuration
    fetch('/api/config/url', { signal: controller.signal })
      .then((res) => res.json())
      .then((data) => {
        const origin = (data.url || fallbackOrigin).replace(/\/$/, '')
        setApiUrl(`${origin}/api/docs/json`)
        if (data.solvaPayConsoleUrl) {
          setSolvaPayConsoleUrl(data.solvaPayConsoleUrl)
        }
      })
      .catch(() => {})
      .finally(() => {
        window.clearTimeout(timeoutId)
      })

    // Check if user is logged in
    fetch('/api/user/info')
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

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-8 md:p-24 max-w-4xl mx-auto">
      {!loadingUser && user && (
        <div className="absolute top-4 right-4">
          <span className="text-sm text-gray-600">
            Signed in as <strong>{user.email || 'User'}</strong>
          </span>
        </div>
      )}

      <h1 className="text-4xl font-bold mb-4 text-center">SolvaPay Custom GPT Actions API</h1>
      <p className="text-xl mb-12 text-center text-gray-600 max-w-2xl">
        This is a backend API for OpenAI Custom GPT Actions.
        It provides a Tasks API secured by SolvaPay OAuth and monetized with SolvaPay.
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
            <p className="text-sm text-gray-500">Use these details in the &quot;Authentication&quot; settings of your Custom GPT</p>
          </div>
          <div className="p-6 space-y-6">
            {/* Instructions for getting OAuth credentials */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
              <h3 className="font-semibold text-amber-900">Get Your OAuth Credentials</h3>
              <p className="text-sm text-amber-800">
                Copy all OAuth credentials from the SolvaPay console. You&apos;ll need:
              </p>
              <ul className="text-sm text-amber-800 list-disc list-inside space-y-1 ml-2">
                <li><strong>Client ID</strong></li>
                <li><strong>Client Secret</strong></li>
                <li><strong>Authorization URL</strong></li>
                <li><strong>Token URL</strong></li>
                <li><strong>Scope:</strong> <code className="text-xs bg-amber-100 px-1 rounded">openid email profile</code></li>
              </ul>
              <div className="flex items-center gap-2">
                <a 
                  href={`${solvaPayConsoleUrl}/provider/settings?tab=oauth`}
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-sm text-amber-900 hover:text-amber-700 underline font-medium"
                >
                  Open SolvaPay Console →
                </a>
              </div>
         
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
