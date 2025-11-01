'use client';

import { useEffect, useState } from 'react';
import { useSubscription } from '@solvapay/react';
import Link from 'next/link';

interface Plan {
  reference: string;
  name: string;
  price?: number;
  isFreeTier?: boolean;
}

export default function HomePage() {
  const { subscriptions, loading } = useSubscription();
  const [plans, setPlans] = useState<Plan[]>([]);
  
  const agentRef = process.env.NEXT_PUBLIC_AGENT_REF;
  
  // Fetch plans to determine which subscriptions are free vs paid
  useEffect(() => {
    const fetchPlans = async () => {
      if (!agentRef) return;
      
      try {
        const response = await fetch(`/api/list-plans?agentRef=${agentRef}`);
        if (response.ok) {
          const data = await response.json();
          setPlans(data.plans || []);
        }
      } catch (err) {
        console.error('Failed to fetch plans:', err);
      }
    };
    
    fetchPlans();
  }, [agentRef]);
  
  // Helper to check if a subscription is for a paid plan
  const isPaidPlan = (planName: string): boolean => {
    const plan = plans.find(p => p.name === planName);
    if (!plan) return true; // Default to paid if plan not found
    return (plan.price ?? 0) > 0 && !plan.isFreeTier;
  };
  
  // Get active paid subscriptions (active and not free)
  const activePaidSubscriptions = subscriptions.filter(
    sub => sub.status === 'active' && isPaidPlan(sub.planName)
  );
  
  // Get all active subscriptions (including free)
  const activeSubscriptions = subscriptions.filter(
    sub => sub.status === 'active'
  );
  
  // Get the most recent active paid subscription
  const mostRecentActivePaidSubscription = activePaidSubscriptions
    .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())[0];
  
  // Get the most recent active subscription (for display)
  const mostRecentActiveSubscription = activeSubscriptions
    .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())[0];
  
  const hasActiveSubscription = activeSubscriptions.length > 0;
  const hasPaidSubscription = activePaidSubscriptions.length > 0;
  
  // Find cancelled paid subscription (most recent cancelled paid subscription)
  const cancelledPaidSubscriptions = subscriptions.filter(
    sub => sub.status === 'cancelled' && isPaidPlan(sub.planName)
  );
  const cancelledSubscription = cancelledPaidSubscriptions
    .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())[0];
  
  // Show cancelled notice if no active paid subscription OR if cancelled has endDate
  const shouldShowCancelledNotice = cancelledSubscription && (!hasPaidSubscription || cancelledSubscription.endDate);
  
  // Format date helper
  const formatDate = (dateString?: string) => {
    if (!dateString) return null;
    return new Date(dateString).toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  };
  
  // Calculate days until expiration
  const getDaysUntilExpiration = (endDate?: string) => {
    if (!endDate) return null;
    const now = new Date();
    const expiration = new Date(endDate);
    const diffTime = expiration.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : 0;
  };

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

  return (
    <div className="min-h-screen bg-white">
      <main className="max-w-4xl mx-auto px-6 py-16">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-3xl font-semibold text-slate-900 mb-3">
            Welcome to Your Dashboard
          </h1>
          {hasPaidSubscription ? (
            <p className="text-slate-600">
              You're on the <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                {mostRecentActivePaidSubscription?.planName}
              </span> plan
            </p>
          ) : hasActiveSubscription ? (
            <p className="text-slate-600">
              You're on the <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                {mostRecentActiveSubscription?.planName}
              </span> plan
            </p>
          ) : shouldShowCancelledNotice ? (
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
          {loading ? (
            <div className="text-center py-8 text-slate-500">Loading...</div>
          ) : hasActiveSubscription ? (
            <div className="text-center py-4">
              <p className="text-slate-900 mb-4">Manage your subscription and billing</p>
              <Link href="/checkout">
                <button className="px-6 py-2.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors">
                  Manage Subscription
                </button>
              </Link>
            </div>
          ) : shouldShowCancelledNotice ? (
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
              <Link href="/checkout">
                <button className="px-6 py-2.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors">
                  Resubscribe
                </button>
              </Link>
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-slate-900 mb-2 font-medium">Upgrade your plan</p>
              <p className="text-slate-600 text-sm mb-6">Get access to advanced features and more</p>
              <Link href="/checkout">
                <button className="px-6 py-2.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors">
                  View Plans
                </button>
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
