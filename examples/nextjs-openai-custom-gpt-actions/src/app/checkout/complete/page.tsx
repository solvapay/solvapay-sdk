'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

export default function CheckoutCompletePage() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [plan, setPlan] = useState('')

  useEffect(() => {
    // Get URL parameters
    const urlParams = new URLSearchParams(window.location.search)
    const planParam = urlParams.get('plan')
    const returnUrl = urlParams.get('return_url')
    
    if (planParam) {
      setPlan(planParam)
    }

    // Simulate processing the checkout completion
    const timer = setTimeout(() => {
      setStatus('success')
      setMessage('Your subscription has been successfully upgraded!')
    }, 2000)

    return () => clearTimeout(timer)
  }, [])

  const planNames = {
    pro: 'PRO Plan',
    enterprise: 'ENTERPRISE Plan'
  }

  const planName = planNames[plan as keyof typeof planNames] || 'PRO Plan'

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 text-center">
          {status === 'loading' && (
            <div role="status" aria-live="polite">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                Processing Payment
              </h2>
              <p className="text-gray-600">
                Please wait while we confirm your subscription...
              </p>
            </div>
          )}

          {status === 'success' && (
            <div>
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                Payment Successful!
              </h2>
              <p className="text-gray-600 mb-4">
                {message}
              </p>
              <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-6">
                <h3 className="text-lg font-semibold text-blue-800 mb-2">
                  {planName}
                </h3>
                <p className="text-sm text-blue-700">
                  Your plan has been upgraded and is now active in ChatGPT.
                </p>
              </div>
              <div className="space-y-3">
                <Link
                  href="/"
                  className="block w-full bg-blue-600 text-white py-2 px-4 rounded-md text-sm font-medium hover:bg-blue-700"
                >
                  Return to Dashboard
                </Link>
                <Link
                  href="/docs"
                  className="block w-full bg-gray-600 text-white py-2 px-4 rounded-md text-sm font-medium hover:bg-gray-700"
                >
                  View API Documentation
                </Link>
              </div>
            </div>
          )}

          {status === 'error' && (
            <div>
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                Payment Failed
              </h2>
              <p className="text-gray-600 mb-6">
                {message || 'There was an error processing your payment. Please try again.'}
              </p>
              <div className="space-y-3">
                <Link
                  href="/checkout"
                  className="block w-full bg-blue-600 text-white py-2 px-4 rounded-md text-sm font-medium hover:bg-blue-700"
                >
                  Try Again
                </Link>
                <Link
                  href="/"
                  className="block w-full bg-gray-600 text-white py-2 px-4 rounded-md text-sm font-medium hover:bg-gray-700"
                >
                  Return to Dashboard
                </Link>
              </div>
            </div>
          )}

          <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-md">
            <h3 className="text-sm font-medium text-blue-800 mb-2">Demo Mode</h3>
            <p className="text-sm text-blue-700">
              This is a demo checkout completion page. In a real implementation, 
              this would verify the payment with your payment processor and 
              update the user&apos;s subscription status.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
