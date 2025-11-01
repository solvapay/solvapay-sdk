'use client';

import Link from 'next/link';
import { PlanBadge, useSubscription } from '@solvapay/react';
import { Button } from './ui/Button';
import { signOut, getUserEmail, onAuthStateChange } from '../lib/supabase';
import { useState, useEffect } from 'react';

/**
 * Navigation Component
 * 
 * Displays navigation bar with current plan badge and upgrade button
 */
export function Navigation() {
  const { subscriptions } = useSubscription();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  
  // Check if user has any active paid subscription (not free plan)
  const hasActivePaidSubscription = subscriptions.some(
    sub => sub.status === 'active' && sub.planName.toLowerCase() !== 'free'
  );

  // Get user email on mount and listen for auth state changes
  useEffect(() => {
    const fetchUserEmail = async () => {
      const email = await getUserEmail();
      setUserEmail(email);
    };
    fetchUserEmail();

    // Listen for auth state changes to update email
    const authStateChange = onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        setUserEmail(session?.user?.email || null);
      } else if (event === 'SIGNED_OUT') {
        setUserEmail(null);
      }
    });

    return () => {
      if (authStateChange?.data?.subscription) {
        authStateChange.data.subscription.unsubscribe();
      }
    };
  }, []);

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
              {({ subscriptions, loading }) => {
                const activeSubs = subscriptions.filter(sub => sub.status === 'active');
                
                // Get the latest active subscription by startDate
                const latestSub = activeSubs.length > 0
                  ? activeSubs.reduce((latest, current) => {
                      return new Date(current.startDate) > new Date(latest.startDate) ? current : latest;
                    })
                  : null;
                
                return (
                  <div className="px-2.5 py-1 rounded-md bg-slate-50 text-xs font-medium">
                    {loading ? (
                      <span className="text-slate-400">Loading...</span>
                    ) : latestSub ? (
                      <span className="text-emerald-600">
                        {latestSub.planName}
                      </span>
                    ) : (
                      <span className="text-slate-500">Free Plan</span>
                    )}
                  </div>
                );
              }}
            </PlanBadge>

            {userEmail && (
              <div className="hidden sm:block text-xs text-slate-500">
                {userEmail}
              </div>
            )}

            {!hasActivePaidSubscription && (
              <Link href="/checkout">
                <Button variant="primary" className="px-4 py-1.5 text-xs">
                  Upgrade
                </Button>
              </Link>
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
