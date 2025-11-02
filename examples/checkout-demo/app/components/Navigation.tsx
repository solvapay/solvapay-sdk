'use client';

import Link from 'next/link';
import { PlanBadge, useSubscription, hasActivePaidSubscription } from '@solvapay/react';
import { Button } from './ui/Button';
import { signOut, getUserEmail, onAuthStateChange } from '../lib/supabase';
import { useState, useEffect } from 'react';

interface Plan {
  reference: string;
  name: string;
  price?: number;
  isFreeTier?: boolean;
}

/**
 * Navigation Component
 * 
 * Displays navigation bar with current plan badge and upgrade button
 */
export function Navigation() {
  const { subscriptions } = useSubscription();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
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
  
  // Check if user has any active paid subscription using shared utility
  const hasActivePaidSubscriptionValue = hasActivePaidSubscription(subscriptions, isPaidPlan);

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

            {userEmail && (
              <div className="hidden sm:block text-xs text-slate-500">
                {userEmail}
              </div>
            )}

            {!hasActivePaidSubscriptionValue && (
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
