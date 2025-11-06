'use client'

import { useSearchParams } from 'next/navigation'
import { useEffect, Suspense } from 'react'

function OAuthCallbackContent() {
  const searchParams = useSearchParams()
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')

  // OAuth Callback received

  useEffect(() => {
    // If successful (has code and no error), auto-close after a short delay
    if (code && !error) {
      // OAuth successful, will auto-close
      const timer = setTimeout(() => {
        if (window.opener) {
          window.close()
        } else {
          window.history.back()
        }
      }, 2000) // 2 second delay to show success message
      
      return () => clearTimeout(timer)
    }
  }, [code, error])

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-md p-6">
          <div className="text-center">
            <div className="text-red-600 text-4xl mb-4">❌</div>
            <h1 className="text-2xl font-bold text-red-600 mb-4">OAuth Error</h1>
            <p className="text-gray-700 mb-2"><strong>Error:</strong> {error}</p>
            <p className="text-gray-700 mb-4"><strong>Description:</strong> {errorDescription || 'Unknown error'}</p>
            <button 
              onClick={() => window.close()} 
              className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!code && !error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-md p-6">
          <div className="text-center">
            <div className="text-red-600 text-4xl mb-4">❌</div>
            <h1 className="text-2xl font-bold text-red-600 mb-4">OAuth Error</h1>
            <p className="text-gray-700 mb-4">No authorization code received</p>
            <button 
              onClick={() => window.close()} 
              className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Success case - show success message with auto-close
  if (code && !error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-md p-6">
          <div className="text-center">
            <div className="text-green-600 text-6xl mb-4">✅</div>
            <h1 className="text-2xl font-bold text-green-600 mb-4">OAuth Successful!</h1>
            <p className="text-gray-700 mb-4">You can now use the integrated features in ChatGPT.</p>
            <p className="text-sm text-gray-500 mb-6">This window will close automatically in 2 seconds...</p>
            
            <button 
              onClick={() => {
                if (window.opener) {
                  window.close()
                } else {
                  window.history.back()
                }
              }} 
              className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700"
            >
              Close & Return to ChatGPT
            </button>
          </div>
        </div>
      </div>
    )
  }

  // This will only show if there's an error (handled above)
  return null
}

export default function OAuthCallbackPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-md p-6">
          <div className="text-center">
            <div className="text-blue-600 text-4xl mb-4">⏳</div>
            <h1 className="text-2xl font-bold text-gray-700 mb-4">Processing OAuth...</h1>
            <p className="text-gray-500">Please wait while we complete the authorization.</p>
          </div>
        </div>
      </div>
    }>
      <OAuthCallbackContent />
    </Suspense>
  )
}