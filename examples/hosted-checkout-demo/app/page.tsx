'use client';

import { useMemo, useCallback, useEffect, useState } from 'react';
import { useSubscription, usePlans, useSubscriptionHelpers } from '@solvapay/react';
import { getAccessToken } from './lib/supabase';

export default function HomePage() {
  const agentRef = process.env.NEXT_PUBLIC_AGENT_REF;
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Memoize the fetcher function to prevent unnecessary re-fetches
  const fetchPlans = useCallback(async (agentRef: string) => {
    const response = await fetch(`/api/list-plans?agentRef=${agentRef}`);
    if (!response.ok) throw new Error('Failed to fetch plans');
    const data = await response.json();
    return data.plans || [];
  }, []);
  
  // Fetch plans using SDK hook
  const { plans, loading: plansLoading } = usePlans({
    agentRef: agentRef || undefined,
    fetcher: fetchPlans,
  });
  
  // Get subscription helpers from SDK
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
  } = useSubscriptionHelpers(plans);
  
  // Combine loading states - only show content when both are loaded
  const isLoading = subscriptionsLoading || plansLoading;
  
  // Get the most recent active subscription (for display - includes free plans)
  const mostRecentActiveSubscription = useMemo(() => {
    const activeSubs = subscriptions.filter(sub => sub.status === 'active');
    return activeSubs.sort((a, b) => 
      new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
    )[0];
  }, [subscriptions]);

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

      const response = await fetch('/api/create-manage-customer-token', {
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

  const FeatureCard = ({ 
    title, 
    description, 
    locked = false 
  }: { 
    title: string; 
    description: string; 
    locked?: boolean;
  }) => (
    <div className={`p-6 rounded-xl border ${locked ? 'border-slate-200 bg-slate-50' : 'border-slate-200 bg-white'} relative`}>
      {locked && (
        <div className="absolute top-4 right-4">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
            Premium
          </span>
        </div>
      )}
      <h3 className={`text-lg font-medium mb-2 ${locked ? 'text-slate-500' : 'text-slate-900'}`}>
        {title}
      </h3>
      <p className={`text-sm ${locked ? 'text-slate-400' : 'text-slate-600'}`}>
        {description}
      </p>
      {locked && (
        <div className="mt-4">
          <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
      )}
    </div>
  );

  // Skeleton loader component
  const Skeleton = ({ className = '' }: { className?: string }) => (
    <div className={`animate-pulse bg-slate-200 rounded ${className}`} />
  );

  return (
    <div className="min-h-screen bg-white">
      <main className="max-w-4xl mx-auto px-6 py-16">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-3xl font-semibold text-slate-900 mb-3">
            Welcome to Your Dashboard
          </h1>
          {isLoading ? (
            <div className="flex justify-center items-center gap-2">
              <Skeleton className="h-5 w-48" />
            </div>
          ) : hasPaidSubscription ? (
            <p className="text-slate-600">
              You're on the <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                {activePaidSubscription?.planName}
              </span> plan
            </p>
          ) : hasActiveSubscription ? (
            <p className="text-slate-600">
              You're on the <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                {mostRecentActiveSubscription?.planName}
              </span> plan
            </p>
          ) : shouldShowCancelledNotice && cancelledSubscription ? (
            <div className="space-y-2">
              <p className="text-slate-600">
                Your <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">
                  {cancelledSubscription.planName}
                </span> subscription has been cancelled
              </p>
              {cancelledSubscription.endDate ? (
                <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-sm font-medium text-amber-900">
                    ⏰ Access expires on {formatDate(cancelledSubscription.endDate)}
                  </p>
                  {(() => {
                    const daysLeft = getDaysUntilExpiration(cancelledSubscription.endDate);
                    return daysLeft !== null && daysLeft > 0 ? (
                      <p className="text-xs text-amber-700 mt-1">
                        {daysLeft} {daysLeft === 1 ? 'day' : 'days'} remaining
                      </p>
                    ) : null;
                  })()}
                  <p className="text-xs text-amber-700 mt-1">
                    You'll continue to have access to {cancelledSubscription.planName} features until this date
                  </p>
                </div>
              ) : (
                <p className="text-sm text-slate-500 mt-1">
                  Your subscription access has ended
                </p>
              )}
              {cancelledSubscription.cancelledAt && (
                <p className="text-xs text-slate-400 mt-2">
                  Cancelled on {formatDate(cancelledSubscription.cancelledAt)}
                  {cancelledSubscription.cancellationReason && ` - ${cancelledSubscription.cancellationReason}`}
                </p>
              )}
            </div>
          ) : (
            <p className="text-slate-600">You don't have an active subscription</p>
          )}
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-2 gap-4 mb-8">
          <FeatureCard
            title="Basic Analytics"
            description="View your daily stats and basic metrics."
          />
          <FeatureCard
            title="Standard Reports"
            description="Generate monthly reports with key insights."
          />
          <FeatureCard
            title="Advanced Analytics"
            description="Real-time data analysis with custom dashboards."
            locked={!hasPaidSubscription}
          />
          <FeatureCard
            title="Priority Support"
            description="Get help from our team within 24 hours."
            locked={!hasPaidSubscription}
          />
        </div>

        {/* CTA Section */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
          {isLoading ? (
            <div className="text-center py-4 space-y-4">
              <Skeleton className="h-5 w-64 mx-auto" />
              <Skeleton className="h-10 w-48 mx-auto" />
            </div>
          ) : hasActiveSubscription ? (
            <div className="text-center py-4">
              <p className="text-slate-900 mb-4">Manage your subscription and billing</p>
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}
              <button
                onClick={handleManageSubscription}
                disabled={isRedirecting}
                className="px-6 py-2.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isRedirecting ? 'Redirecting...' : 'Manage Subscription'}
              </button>
            </div>
          ) : shouldShowCancelledNotice && cancelledSubscription ? (
            <div className="text-center py-4">
              <p className="text-slate-900 mb-2 font-medium">Your subscription is cancelled</p>
              {cancelledSubscription.endDate ? (
                <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-sm font-semibold text-amber-900 mb-1">
                    ⏰ Subscription Expires: {formatDate(cancelledSubscription.endDate)}
                  </p>
                  {(() => {
                    const daysLeft = getDaysUntilExpiration(cancelledSubscription.endDate);
                    return daysLeft !== null && daysLeft > 0 ? (
                      <p className="text-xs text-amber-700 mb-1">
                        {daysLeft} {daysLeft === 1 ? 'day' : 'days'} remaining
                      </p>
                    ) : null;
                  })()}
                  <p className="text-xs text-amber-700">
                    You'll continue to have access to {cancelledSubscription.planName} features until this date
                  </p>
                </div>
              ) : (
                <p className="text-slate-600 text-sm mb-6">
                  Your subscription access has ended
                </p>
              )}
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}
              <button
                onClick={() => handleViewPlans()}
                disabled={isRedirecting}
                className="px-6 py-2.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isRedirecting ? 'Redirecting...' : 'Resubscribe'}
              </button>
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-slate-900 mb-2 font-medium">Upgrade your plan</p>
              <p className="text-slate-600 text-sm mb-6">Get access to advanced features and more</p>
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}
              <button
                onClick={() => handleViewPlans()}
                disabled={isRedirecting}
                className="px-6 py-2.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isRedirecting ? 'Redirecting...' : 'View Plans'}
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
