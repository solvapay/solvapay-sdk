'use client';

import Link from 'next/link';
import { PlanBadge, useSubscription } from '@solvapay/react';
import { Button } from './ui/Button';
import { signOut, getAccessToken } from '../lib/supabase';
import { useState, useCallback } from 'react';

/**
 * Navigation Component
 * 
 * Displays navigation bar with current plan badge and upgrade button
 */
export function Navigation() {
  const { loading: subscriptionsLoading, hasPaidSubscription } = useSubscription();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  
  const agentRef = process.env.NEXT_PUBLIC_AGENT_REF;
  
  // Show upgrade button when subscriptions are loaded and user doesn't have paid subscription
  const showUpgradeButton = !subscriptionsLoading && !hasPaidSubscription;

  // Handle redirect to hosted checkout page
  const handleUpgrade = useCallback(async () => {
    if (!agentRef) {
      alert('Agent reference is not configured');
      return;
    }

    setIsRedirecting(true);

    try {
      const accessToken = await getAccessToken();
      
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };
      
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers,
        body: JSON.stringify({ agentRef }),
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
      alert(err instanceof Error ? err.message : 'Failed to redirect to checkout');
      setIsRedirecting(false);
    }
  }, [agentRef]);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      const result = await signOut();
      
      if (result.error) {
        console.error('Sign out error:', result.error);
        alert('Failed to sign out. Please try again.');
        return;
      }
      
      // Wait a moment for auth state change to propagate
      // The auth state change listener in layout will handle the UI update
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Redirect to ensure clean state (especially important for OAuth sessions)
      window.location.href = '/';
    } catch (error) {
      console.error('Failed to sign out:', error);
      alert('Failed to sign out. Please try again.');
      setIsSigningOut(false);
    }
  };

  return (
    <nav className="bg-white border-b border-slate-100 sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-14">
          <Link href="/" className="text-lg font-medium text-slate-900 no-underline hover:text-slate-700 transition-colors">
            SolvaPay Demo
          </Link>

          <div className="flex items-center gap-4">
            <PlanBadge>
              {({ displayPlan, shouldShow }) => {
                // Badge handles hiding internally, only render if shouldShow is true
                if (!shouldShow) {
                  return null;
                }
                
                return (
                  <div className="px-2.5 py-1 rounded-md bg-slate-50 text-xs font-medium">
                    <span className="text-emerald-600">
                      {displayPlan}
                    </span>
                  </div>
                );
              }}
            </PlanBadge>

            {/* Upgrade button - hidden until loaded */}
            {showUpgradeButton && (
              <Button
                variant="primary"
                className="px-4 py-1.5 text-xs"
                onClick={handleUpgrade}
                disabled={isRedirecting}
              >
                {isRedirecting ? 'Redirecting...' : 'Upgrade'}
              </Button>
            )}

            <button
              onClick={handleSignOut}
              disabled={isSigningOut}
              className="text-xs text-slate-500 hover:text-slate-900 transition-colors disabled:opacity-50"
            >
              {isSigningOut ? 'Signing out...' : 'Sign Out'}
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
