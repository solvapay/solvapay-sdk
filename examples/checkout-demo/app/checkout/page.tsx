'use client';

import { useState, useEffect, useRef } from 'react';
import { PaymentForm, useSubscription } from '@solvapay/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getAccessToken } from '../lib/supabase';

interface Plan {
  reference: string;
  name: string;
  description?: string;
  price?: number;
  currency?: string;
  interval?: string;
  features?: string[];
  isFreeTier?: boolean;
  metadata?: Record<string, any>;
}

export default function CheckoutPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlanIndex, setSelectedPlanIndex] = useState<number>(0);
  const [showPaymentForm, setShowPaymentForm] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState<boolean>(false);
  const [isCancelling, setIsCancelling] = useState<boolean>(false);
  const { subscriptions, refetch } = useSubscription();
  const router = useRouter();
  const redirectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const agentRef = process.env.NEXT_PUBLIC_AGENT_REF;

  // Fetch plans from the backend
  useEffect(() => {
    const fetchPlans = async () => {
      if (!agentRef) {
        setError('Agent reference not configured');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        
        const response = await fetch(`/api/list-plans?agentRef=${agentRef}`);
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to fetch plans');
        }

        const data = await response.json();
        
        // Sort plans by price, limit to first 2
        const sortedPlans = (data.plans || [])
          .sort((a: Plan, b: Plan) => (a.price || 0) - (b.price || 0))
          .slice(0, 2);

        if (sortedPlans.length === 0) {
          throw new Error('No plans available');
        }

        // Set initial selection to first paid plan (skip free plans with price === 0)
        const firstPaidIndex = sortedPlans.findIndex((plan: Plan) => plan.price && plan.price > 0);
        setPlans(sortedPlans);
        // Only set selection if we found a paid plan, otherwise default to 0
        if (firstPaidIndex >= 0) {
          setSelectedPlanIndex(firstPaidIndex);
        } else {
          setSelectedPlanIndex(0);
        }
      } catch (err) {
        console.error('Failed to fetch plans:', err);
        setError(err instanceof Error ? err.message : 'Failed to load plans');
      } finally {
        setLoading(false);
      }
    };

    fetchPlans();
  }, [agentRef]);

  const currentPlan = plans[selectedPlanIndex];
  
  // Get the active subscription's plan name
  const activeSubscription = subscriptions.find(sub => sub.status === 'active');
  const activePlanName = activeSubscription?.planName;

  const handlePaymentSuccess = async () => {
    setPaymentSuccess(true);
    redirectTimeoutRef.current = setTimeout(() => {
      router.push('/');
    }, 2000);
  };

  useEffect(() => {
    return () => {
      if (redirectTimeoutRef.current) {
        clearTimeout(redirectTimeoutRef.current);
      }
    };
  }, []);

  const handlePaymentError = (err: Error) => {
    console.error('Payment failed:', err);
    setShowPaymentForm(false);
  };

  const handleContinue = () => {
    if (currentPlan && currentPlan.price && currentPlan.price > 0) {
      setShowPaymentForm(true);
    }
  };

  const handleCancelPlan = async () => {
    if (!confirm('Are you sure you want to cancel your plan? You will be moved to the free plan.')) {
      return;
    }

    // Find the active paid subscription to cancel
    const activePaidSubscription = subscriptions.find(
      sub => sub.status === 'active' && sub.planName.toLowerCase() !== 'free'
    );

    if (!activePaidSubscription) {
      setError('No active subscription found to cancel');
      return;
    }

    setIsCancelling(true);
    setError(null);

    try {
      // Get access token for authentication
      const accessToken = await getAccessToken();
      
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };
      
      // Add Authorization header if we have an access token
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      // Call cancel subscription API
      const res = await fetch('/api/cancel-subscription', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          subscriptionRef: activePaidSubscription.reference,
          reason: 'User requested cancellation',
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const errorMessage = errorData.error || 'Failed to cancel subscription';
        throw new Error(errorMessage);
      }

      // Refetch subscriptions to update the UI
      await refetch();

      // Navigate to home page to show free subscription
      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel subscription');
      setIsCancelling(false);
    }
  };

  const price = currentPlan ? (currentPlan.price || 0) / 100 : 0;

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-2xl mx-auto px-6 py-12">
        <Link href="/" className="text-slate-600 hover:text-slate-900 mb-8 inline-block">
          ← Back
        </Link>

        {paymentSuccess ? (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold text-slate-900 mb-2">Payment Successful!</h2>
            <p className="text-slate-600 mb-4">Your subscription has been activated.</p>
            <p className="text-sm text-slate-500">Redirecting to home page...</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
            <h2 className="text-xl font-semibold text-slate-900 mb-8">Choose your subscription</h2>

            {loading && (
              <div className="text-center py-8 text-slate-500">Loading plans...</div>
            )}

            {error && !loading && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-center">
                {error}
              </div>
            )}

            {!loading && !error && plans.length > 0 && !showPaymentForm && (
              <>
                {/* Plan Selection Cards */}
                <div className="grid grid-cols-2 gap-4 mb-8">
                  {plans.map((plan, index) => {
                    const isFreePlan = !plan.price || plan.price === 0;
                    const isCurrentPlan = plan.name === activePlanName;
                    const isSelected = !isFreePlan && selectedPlanIndex === index;
                    const planPrice = plan.price ? Math.floor(plan.price / 100) : '0';

                    return (
                      <div
                        key={plan.reference}
                        className={`relative p-6 border-2 rounded-xl transition-all ${
                          isFreePlan
                            ? 'border-slate-200 bg-slate-50 cursor-not-allowed opacity-60'
                            : isSelected
                            ? 'border-green-500 bg-white shadow-sm cursor-pointer'
                            : 'border-slate-200 bg-white hover:border-slate-300 cursor-pointer'
                        }`}
                        onClick={() => {
                          if (!isFreePlan) {
                            setSelectedPlanIndex(index);
                          }
                        }}
                      >
                        {isSelected && (
                          <div className="absolute top-2 right-2 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                        )}
                        {isCurrentPlan && (
                          <div className="absolute -top-2 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-xs font-medium px-3 py-1 rounded-full">
                            Current Plan
                          </div>
                        )}
                        {!isCurrentPlan && index === 1 && !isFreePlan && (
                          <div className="absolute -top-2 left-1/2 -translate-x-1/2 bg-blue-500 text-white text-xs font-medium px-2 py-0.5 rounded-full">
                            Popular
                          </div>
                        )}
                        <div className="text-2xl font-bold text-slate-900 mb-1">${planPrice}</div>
                        <div className="text-sm text-slate-600">{plan.name}</div>
                      </div>
                    );
                  })}
                </div>

                {/* Total */}
                <div className="flex justify-between items-center mb-8">
                  <span className="text-sm font-medium text-slate-900">Total</span>
                  <span className="text-xl font-bold text-slate-900">${Math.floor(price)}</span>
                </div>

                {/* Continue Button or Cancel Plan Button */}
                {activePlanName && activePlanName.toLowerCase() !== 'free' ? (
                  <button
                    onClick={handleCancelPlan}
                    disabled={isCancelling}
                    className="w-full py-3 border-2 border-slate-300 text-slate-900 rounded-lg hover:border-red-500 hover:text-red-600 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isCancelling ? 'Cancelling...' : 'Cancel Plan'}
                  </button>
                ) : (
                  <button
                    onClick={handleContinue}
                    className="w-full py-3 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors font-medium"
                  >
                    Continue
                  </button>
                )}
              </>
            )}

            {/* Payment Form */}
            {showPaymentForm && currentPlan && (
              <div className="space-y-6">
                <div className="pb-6 border-b border-slate-200">
                  <div className="flex justify-between items-center mb-4">
                    <span className="text-sm text-slate-600">Selected Plan:</span>
                    <span className="text-sm font-medium text-slate-900">{currentPlan.name}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-600">Total:</span>
                    <span className="text-lg font-bold text-slate-900">${Math.floor(price)}</span>
                  </div>
                </div>

                <PaymentForm
                  planRef={currentPlan.reference}
                  onSuccess={handlePaymentSuccess}
                  onError={handlePaymentError}
                  submitButtonText="Complete Purchase"
                  className="space-y-6"
                  buttonClassName="w-full py-3 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors font-medium disabled:opacity-60 disabled:cursor-not-allowed"
                />

                <button
                  onClick={() => setShowPaymentForm(false)}
                  className="mt-6 text-sm text-slate-600 hover:text-slate-900 block"
                >
                  ← Back to plan selection
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
