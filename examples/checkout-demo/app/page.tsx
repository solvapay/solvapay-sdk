'use client';

import { useSubscription } from '@solvapay/react';
import Link from 'next/link';

export default function HomePage() {
  const { subscriptions, loading } = useSubscription();
  
  const hasActiveSubscription = subscriptions.some(
    sub => sub.status === 'active' && sub.planName.toLowerCase() !== 'free'
  );

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
            Pro
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
          {hasActiveSubscription ? (
            <p className="text-slate-600">
              You're on the <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                {subscriptions.find(s => s.status === 'active' && s.planName.toLowerCase() !== 'free')?.planName || 'Pro'}
              </span> plan
            </p>
          ) : (
            <p className="text-slate-600">You're currently on the Free plan</p>
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
            locked={!hasActiveSubscription}
          />
          <FeatureCard
            title="Priority Support"
            description="Get help from our team within 24 hours."
            locked={!hasActiveSubscription}
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
          ) : (
            <div className="text-center py-4">
              <p className="text-slate-900 mb-2 font-medium">Unlock all Pro features</p>
              <p className="text-slate-600 text-sm mb-6">Get access to advanced analytics, priority support, and more</p>
              <Link href="/checkout">
                <button className="px-6 py-2.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors">
                  Upgrade to Pro
                </button>
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
