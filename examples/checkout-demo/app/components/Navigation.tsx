'use client';

import Link from 'next/link';
import { PlanBadge, useSubscription } from '@solvapay/react';
import { Button } from './ui/Button';

/**
 * Navigation Component
 * 
 * Displays navigation bar with current plan badge and upgrade button
 */
export function Navigation() {
  const { subscriptions } = useSubscription();
  
  // Check if user has any active paid subscription (not free plan)
  const hasActivePaidSubscription = subscriptions.some(
    sub => sub.status === 'active' && sub.planName.toLowerCase() !== 'free'
  );

  return (
    <nav className="bg-white/80 backdrop-blur-sm border-b border-slate-200/60 sticky top-0 z-50 shadow-sm">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16 sm:h-20">
          <Link href="/" className="text-xl sm:text-2xl font-semibold text-slate-900 no-underline hover:text-slate-700 transition-colors">
            SolvaPay Demo
          </Link>

          <div className="flex items-center gap-3 sm:gap-4">
            <PlanBadge>
              {({ subscriptions, loading }) => {
                const activeSubs = subscriptions.filter(sub => sub.status === 'active');
                
                // Get the latest active subscription by startDate
                const latestSub = activeSubs.length > 0
                  ? activeSubs.reduce((latest, current) => {
                      return new Date(current.startDate) > new Date(latest.startDate) ? current : latest;
                    })
                  : null;
                
                return (
                  <div className="px-4 py-2 sm:px-5 sm:py-2.5 rounded-xl bg-slate-100 border border-slate-200/60 text-sm sm:text-base font-medium shadow-sm">
                    {loading ? (
                      <span className="text-slate-500">Loading...</span>
                    ) : latestSub ? (
                      <span className="text-emerald-700 font-semibold">
                        ✓ {latestSub.planName}
                      </span>
                    ) : (
                      <span className="text-slate-600">Free Plan</span>
                    )}
                  </div>
                );
              }}
            </PlanBadge>

            {!hasActivePaidSubscription && (
              <Link href="/checkout">
                <Button variant="primary" className="px-5 sm:px-6 py-2.5 sm:py-3 text-sm sm:text-base">
                  Upgrade
                </Button>
              </Link>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
