'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSubscription, useSubscriptionHelpers } from '@solvapay/react';
import { getAccessToken } from '@/lib/supabase';

interface ApiStatus {
  tasks: boolean
  oauth: boolean
}

export default function HomePage() {
  const agentRef = process.env.NEXT_PUBLIC_AGENT_REF;
  const [apiStatus, setApiStatus] = useState<ApiStatus>({
    tasks: false,
    oauth: false
  })
  const [loading, setLoading] = useState(true)
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get subscription helpers from SDK
  // Note: Plans are handled on the hosted checkout page, so we pass empty array
  // This will treat all subscriptions as paid plans (default behavior when plan not found)
  const { subscriptions, loading: subscriptionsLoading, hasActiveSubscription, refetch } = useSubscription();
  
  // Refetch subscriptions on mount to ensure we have latest data after navigation
  useEffect(() => {
    refetch().catch((error) => {
      console.error('[HomePage] Refetch failed:', error);
    });
  }, [refetch]);
  
  const {
    hasPaidSubscription,
    activePaidSubscription,
    cancelledSubscription,
    shouldShowCancelledNotice,
    formatDate,
    getDaysUntilExpiration,
  } = useSubscriptionHelpers([]);
  
  // Loading state - only subscriptions loading since plans are on hosted page
  const isLoading = subscriptionsLoading;

  useEffect(() => {
    const checkApiStatus = async () => {
      try {
        // Check tasks endpoint
        const tasksRes = await fetch('/api/tasks')
        const tasksOk = tasksRes.ok

        // Check OAuth endpoint
        const oauthRes = await fetch('/api/oauth/authorize')
        const oauthOk = oauthRes.ok

        setApiStatus({
          tasks: tasksOk,
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

  // Handle redirect to hosted checkout page
  const handleViewPlans = useCallback(async (planRef?: string) => {
    if (!agentRef) {
      setError('Agent reference is not configured');
      return;
    }

    setIsRedirecting(true);
    setError(null);

    try {
      const accessToken = await getAccessToken();
      
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };
      
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      const requestBody: { agentRef: string; planRef?: string } = {
        agentRef,
      };

      if (planRef) {
        requestBody.planRef = planRef;
      }

      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error || errorData.details || 'Failed to create checkout session';
        throw new Error(errorMessage);
      }

      const { checkoutUrl } = await response.json();

      if (!checkoutUrl) {
        throw new Error('No checkout URL returned');
      }

      // Redirect to hosted checkout page
      window.location.href = checkoutUrl;
    } catch (err) {
      console.error('Failed to redirect to checkout:', err);
      setError(err instanceof Error ? err.message : 'Failed to redirect to checkout');
      setIsRedirecting(false);
    }
  }, [agentRef]);

  // Handle redirect to hosted customer management page
  const handleManageSubscription = useCallback(async () => {
    setIsRedirecting(true);
    setError(null);

    try {
      const accessToken = await getAccessToken();
      
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };
      
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      const response = await fetch('/api/create-customer-session', {
        method: 'POST',
        headers,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error || errorData.details || 'Failed to create management token';
        throw new Error(errorMessage);
      }

      const { customerUrl } = await response.json();

      if (!customerUrl) {
        throw new Error('No customer URL returned');
      }

      // Redirect to hosted customer management page
      window.location.href = customerUrl;
    } catch (err) {
      console.error('Failed to redirect to customer management:', err);
      setError(err instanceof Error ? err.message : 'Failed to redirect to customer management');
      setIsRedirecting(false);
    }
  }, []);

  // Get the most recent active subscription (for display - includes free plans)
  const mostRecentActiveSubscription = useMemo(() => {
    const activeSubs = subscriptions.filter(sub => sub.status === 'active');
    return activeSubs.sort((a, b) => 
      new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
    )[0];
  }, [subscriptions]);

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
        
        {/* Subscription Status */}
        {isLoading ? (
          <div className="flex items-center space-x-2 mb-4">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
            <span className="text-gray-600 text-sm">Loading subscription status...</span>
          </div>
        ) : hasPaidSubscription ? (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-sm text-green-800">
              You&apos;re on the <span className="font-semibold">{activePaidSubscription?.planName}</span> plan
            </p>
          </div>
        ) : hasActiveSubscription ? (
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-800">
              You&apos;re on the <span className="font-semibold">{mostRecentActiveSubscription?.planName}</span> plan
            </p>
          </div>
        ) : shouldShowCancelledNotice && cancelledSubscription ? (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-sm font-medium text-amber-900">
              Your <span className="font-semibold">{cancelledSubscription.planName}</span> subscription has been cancelled
            </p>
            {cancelledSubscription.endDate && (
              <p className="text-xs text-amber-700 mt-1">
                Access expires on {formatDate(cancelledSubscription.endDate)}
              </p>
            )}
          </div>
        ) : null}
        
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-center space-x-2">
              <div className={`w-3 h-3 rounded-full ${apiStatus.tasks ? 'bg-green-500' : 'bg-red-500'}`}></div>
              <span className="text-sm font-medium">Tasks API</span>
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
            Full CRUD operations for tasks with paywall protection via API endpoints.
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
          {hasActiveSubscription ? (
            <button
              onClick={handleManageSubscription}
              disabled={isRedirecting}
              className="text-blue-600 hover:text-blue-800 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRedirecting ? 'Redirecting...' : 'Manage Subscription →'}
            </button>
          ) : (
            <button
              onClick={() => handleViewPlans()}
              disabled={isRedirecting}
              className="text-blue-600 hover:text-blue-800 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRedirecting ? 'Redirecting...' : 'Upgrade Plan →'}
            </button>
          )}
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
                  const res = await fetch('/api/tasks')
                  const data = await res.json()
                  alert(`Tasks List: ${JSON.stringify(data, null, 2)}`)
                } catch (error) {
                  alert(`Error: ${error}`)
                }
              }}
              className="bg-green-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-green-700"
            >
              List Tasks
            </button>
            <button 
              onClick={async () => {
                try {
                  const res = await fetch('/api/tasks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: 'Test Task', description: 'Created from UI' })
                  })
                  const data = await res.json()
                  alert(`Create Task: ${JSON.stringify(data, null, 2)}`)
                } catch (error) {
                  alert(`Error: ${error}`)
                }
              }}
              className="bg-purple-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-purple-700"
            >
              Create Task
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
