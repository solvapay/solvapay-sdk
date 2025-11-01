'use client'

import { useState, useEffect } from 'react'

interface ApiStatus {
  health: boolean
  things: boolean
  oauth: boolean
}

export default function HomePage() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>({
    health: false,
    things: false,
    oauth: false
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const checkApiStatus = async () => {
      try {
        // Check health endpoint
        const healthRes = await fetch('/api/healthz')
        const healthOk = healthRes.ok

        // Check things endpoint
        const thingsRes = await fetch('/api/tasks')
        const thingsOk = thingsRes.ok

        // Check OAuth endpoint
        const oauthRes = await fetch('/api/oauth/authorize')
        const oauthOk = oauthRes.ok

        setApiStatus({
          health: healthOk,
          things: thingsOk,
          oauth: oauthOk
        })
      } catch (error) {
        console.error('Error checking API status:', error)
      } finally {
        setLoading(false)
      }
    }

    checkApiStatus()
  }, [])

  return (
    <div className="px-4 sm:px-0">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">
          SolvaPay Custom GPT Actions Demo
        </h1>
        <p className="text-lg text-gray-600 mb-6">
          A Next.js frontend demonstrating SolvaPay&apos;s paywall-protected API endpoints 
          designed for OpenAI Custom GPT Actions integration.
        </p>
      </div>

      {/* API Status */}
      <div className="bg-white shadow rounded-lg p-6 mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">API Status</h2>
        {loading ? (
          <div className="flex items-center space-x-2" role="status" aria-live="polite">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
            <span className="text-gray-600">Checking API status...</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex items-center space-x-2">
              <div className={`w-3 h-3 rounded-full ${apiStatus.health ? 'bg-green-500' : 'bg-red-500'}`}></div>
              <span className="text-sm font-medium">Health Endpoint</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className={`w-3 h-3 rounded-full ${apiStatus.things ? 'bg-green-500' : 'bg-red-500'}`}></div>
              <span className="text-sm font-medium">Things API</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className={`w-3 h-3 rounded-full ${apiStatus.oauth ? 'bg-green-500' : 'bg-red-500'}`}></div>
              <span className="text-sm font-medium">OAuth Endpoints</span>
            </div>
          </div>
        )}
      </div>

      {/* Features Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        <div className="bg-white shadow rounded-lg p-6">
          <div className="flex items-center mb-4">
            <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center mr-3">
              <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900">API Endpoints</h3>
          </div>
          <p className="text-gray-600 text-sm mb-4">
            Full CRUD operations for &ldquo;things&rdquo; with paywall protection via API endpoints.
          </p>
          <a href="/docs" className="text-blue-600 hover:text-blue-800 text-sm font-medium">
            View API Docs →
          </a>
        </div>

        <div className="bg-white shadow rounded-lg p-6">
          <div className="flex items-center mb-4">
            <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center mr-3">
              <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900">OAuth Login</h3>
          </div>
          <p className="text-gray-600 text-sm mb-4">
            OAuth 2.0 authentication flow for Custom GPT Actions integration.
          </p>
          <a href="/oauth/authorize" className="text-blue-600 hover:text-blue-800 text-sm font-medium">
            OAuth Login →
          </a>
        </div>

        <div className="bg-white shadow rounded-lg p-6">
          <div className="flex items-center mb-4">
            <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center mr-3">
              <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900">Plan Upgrade</h3>
          </div>
          <p className="text-gray-600 text-sm mb-4">
            Subscription management and plan upgrade checkout flow.
          </p>
          <a href="/checkout" className="text-blue-600 hover:text-blue-800 text-sm font-medium">
            Upgrade Plan →
          </a>
        </div>
      </div>

      {/* Quick Test Section */}
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Quick API Test</h2>
        <p className="text-gray-600 mb-4">
          Test the API endpoints directly from this interface:
        </p>
        <div className="space-y-4">
          <div className="flex items-center space-x-4">
            <button 
              onClick={async () => {
                try {
                  const res = await fetch('/api/healthz')
                  const data = await res.json()
                  alert(`Health Check: ${JSON.stringify(data, null, 2)}`)
                } catch (error) {
                  alert(`Error: ${error}`)
                }
              }}
              className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700"
            >
              Test Health
            </button>
            <button 
              onClick={async () => {
                try {
                  const res = await fetch('/api/tasks')
                  const data = await res.json()
                  alert(`Things List: ${JSON.stringify(data, null, 2)}`)
                } catch (error) {
                  alert(`Error: ${error}`)
                }
              }}
              className="bg-green-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-green-700"
            >
              List Things
            </button>
            <button 
              onClick={async () => {
                try {
                  const res = await fetch('/api/things', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: 'Test Thing', description: 'Created from UI' })
                  })
                  const data = await res.json()
                  alert(`Create Thing: ${JSON.stringify(data, null, 2)}`)
                } catch (error) {
                  alert(`Error: ${error}`)
                }
              }}
              className="bg-purple-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-purple-700"
            >
              Create Thing
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
