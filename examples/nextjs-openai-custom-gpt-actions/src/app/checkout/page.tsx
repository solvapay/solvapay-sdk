'use client'

import { useState, useEffect } from 'react'

interface CheckoutProps {
  plan?: string
  return_url?: string
  user_id?: string
}

export default function CheckoutPage() {
  const [plan, setPlan] = useState('pro')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [view, setView] = useState<'plan' | 'payment-confirmation'>('plan')

  useEffect(() => {
    // Get URL parameters
    const urlParams = new URLSearchParams(window.location.search)
    const planParam = urlParams.get('plan')
    const returnUrl = urlParams.get('return_url')
    const userId = urlParams.get('user_id')
    
    if (planParam) setPlan(planParam)

    // Hide the navigation immediately
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

    return () => {
      document.head.removeChild(style)
    }
  }, [])

  const handleUpgrade = async () => {
    setLoading(true)
    setError('')

    try {
      // Simulate processing delay
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      // Move to payment confirmation view
      setView('payment-confirmation')
      setLoading(false)
    } catch (err) {
      setError('Error: ' + (err as Error).message)
      setLoading(false)
    }
  }

  const handleConfirmPayment = async () => {
    setLoading(true)
    setError('')

    try {
      // Simulate payment processing
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      // Get current URL parameters for redirect
      const urlParams = new URLSearchParams(window.location.search)
      const returnUrl = urlParams.get('return_url')
      
      // Validate required parameters
      if (!returnUrl) {
        setError('Missing required parameter: return_url')
        setLoading(false)
        return
      }
      
      // Redirect to API route for checkout completion
      // The API route will process the payment and redirect to the completion page
      const customerRef = urlParams.get('customer_ref')
      const completeUrl = `/api/checkout/complete?plan=${encodeURIComponent(plan)}&return_url=${encodeURIComponent(returnUrl)}${customerRef ? `&customer_ref=${encodeURIComponent(customerRef)}` : ''}`
      window.location.href = completeUrl
    } catch (err) {
      setError('Error: ' + (err as Error).message)
      setLoading(false)
    }
  }

  const planFeatures = {
    pro: {
      name: 'PRO Plan',
      price: 29,
      features: [
        'Unlimited API calls',
        'Priority support',
        'Advanced analytics',
        'Custom integrations'
      ]
    },
    enterprise: {
      name: 'ENTERPRISE Plan',
      price: 99,
      features: [
        'Everything in Pro',
        'Dedicated support',
        'Custom SLA',
        'On-premise deployment'
      ]
    }
  }

  const currentPlan = planFeatures[plan as keyof typeof planFeatures] || planFeatures.pro

  const renderPlanView = () => (
    <div className="bg-white border border-gray-200 rounded-lg p-8">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Select Your Plan</h2>
        <div className="grid grid-cols-1 gap-4">
          {Object.entries(planFeatures).map(([planKey, planData]) => (
            <div
              key={planKey}
              className={`border rounded-lg p-4 cursor-pointer transition-all ${
                plan === planKey
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
              onClick={() => setPlan(planKey)}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-gray-900">{planData.name}</div>
                  <div className="text-sm text-gray-600">${planData.price}/month</div>
                </div>
                <div className={`w-4 h-4 rounded-full border-2 ${
                  plan === planKey ? 'border-blue-500 bg-blue-500' : 'border-gray-300'
                }`} />
              </div>
            </div>
          ))}
        </div>
      </div>
      
      <div className="border-b border-gray-100 pb-6 mb-6">
        <div className="text-xl font-semibold text-gray-900 mb-1">{currentPlan.name}</div>
        <div>
          <span className="text-3xl font-bold text-gray-900">${currentPlan.price}</span>
          <span className="text-base text-gray-600 ml-1">/month</span>
        </div>
      </div>

      <div className="mb-8">
        {currentPlan.features.map((feature, index) => (
          <div key={index} className="flex items-center mb-3 text-sm text-gray-700">
            <svg className="w-4 h-4 mr-3 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            {feature}
          </div>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-md mb-4 text-sm">{error}</div>
      )}

      <button
        onClick={handleUpgrade}
        disabled={loading}
        className="w-full bg-gray-900 text-white border-none py-4 rounded-md text-base font-medium cursor-pointer hover:bg-gray-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? (
          <div className="inline-flex items-center">
            <div className="w-4 h-4 border-2 border-transparent border-t-current rounded-full animate-spin mr-2"></div>
            Processing...
          </div>
        ) : (
          `Upgrade to ${currentPlan.name}`
        )}
      </button>
    </div>
  )

  const renderPaymentConfirmation = () => (
    <div className="bg-white border border-gray-200 rounded-lg p-8">
      <div className="border-b border-gray-100 pb-6 mb-6">
        <div className="text-xl font-semibold text-gray-900 mb-1">{currentPlan.name}</div>
        <div>
          <span className="text-3xl font-bold text-gray-900">${currentPlan.price}</span>
          <span className="text-base text-gray-600 ml-1">/month</span>
        </div>
      </div>

      <div className="mb-8">
        <div className="flex justify-between mb-3 text-sm">
          <span className="text-gray-600">Plan:</span>
          <span className="text-gray-900 font-medium">{currentPlan.name}</span>
        </div>
        <div className="flex justify-between mb-3 text-sm">
          <span className="text-gray-600">Amount:</span>
          <span className="text-gray-900 font-medium">${currentPlan.price}/month</span>
        </div>
        <div className="flex justify-between mb-3 text-sm">
          <span className="text-gray-600">Billing:</span>
          <span className="text-gray-900 font-medium">Monthly subscription</span>
        </div>
        <div className="flex justify-between mb-3 text-sm">
          <span className="text-gray-600">Payment Method:</span>
          <span className="text-gray-900 font-medium">Demo Credit Card ending in 4242</span>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-md mb-4 text-sm">{error}</div>
      )}

      <div className="flex flex-col gap-3">
        <button
          onClick={handleConfirmPayment}
          disabled={loading}
          className="w-full bg-gray-900 text-white border-none py-4 rounded-md text-base font-medium cursor-pointer hover:bg-gray-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? (
            <div className="inline-flex items-center">
              <div className="w-4 h-4 border-2 border-transparent border-t-current rounded-full animate-spin mr-2"></div>
              Processing Payment...
            </div>
          ) : (
            'Confirm Payment'
          )}
        </button>
        
        <button
          onClick={() => setView('plan')}
          disabled={loading}
          className="w-full bg-transparent text-gray-600 border border-gray-200 py-4 rounded-md text-base font-medium cursor-pointer hover:bg-gray-50 hover:text-gray-700 disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed transition-all"
        >
          ← Back to Plan
        </button>
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 bg-gray-50 z-50 overflow-y-auto">
      <div className="max-w-md mx-auto py-10 px-5 relative font-sans">
        <button 
          className="absolute top-5 right-5 bg-transparent border-none text-gray-400 cursor-pointer p-2 rounded text-xl leading-none hover:text-gray-600 transition-colors"
          onClick={() => {
            const returnUrl = new URLSearchParams(window.location.search).get('return_url');
            if (returnUrl) {
              window.location.href = returnUrl;
            } else {
              window.close();
            }
          }}
          title="Close"
        >
          ×
        </button>
        
        <div className="text-center mb-10 mt-5">
          <h1 className="text-3xl font-semibold text-gray-900 mb-2">
            {view === 'plan' ? 'Upgrade Plan' : 'Confirm Payment'}
          </h1>
          <p className="text-base text-gray-600">
            {view === 'plan' 
              ? 'Choose the plan that fits your needs' 
              : 'Review your payment details below'
            }
          </p>
        </div>

        {view === 'plan' ? renderPlanView() : renderPaymentConfirmation()}

        <div className="bg-gray-100 border border-gray-300 text-gray-600 p-4 rounded-md text-sm mt-6">
          <strong>Demo Mode:</strong> This is a demonstration checkout page. In a real implementation, this would integrate with SolvaPay as the payment processor to handle actual payments.
        </div>
      </div>
    </div>
  )
}
