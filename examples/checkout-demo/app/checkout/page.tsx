'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSubscription, useCheckout, usePlans, useSubscriptionStatus } from '@solvapay/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getAccessToken } from '../lib/supabase';
import { sortPlansByPrice } from './utils/planHelpers';
import { PlanSelectionSection } from './components/PlanSelectionSection';
import { PaymentSummary } from './components/PaymentSummary';
import { SubscriptionNotices } from './components/SubscriptionNotices';
import { CheckoutActions } from './components/CheckoutActions';
import { PaymentFormSection } from './components/PaymentFormSection';
import { SuccessMessage } from './components/SuccessMessage';
import { PaymentFailureMessage } from './components/PaymentFailureMessage';

export default function CheckoutPage() {
  const [showPaymentForm, setShowPaymentForm] = useState<boolean>(false);
  const [paymentSuccess, setPaymentSuccess] = useState<boolean>(false);
  const [paymentFailed, setPaymentFailed] = useState<boolean>(false);
  const [isCancelling, setIsCancelling] = useState<boolean>(false);
  const { subscriptions, refetch } = useSubscription();
  const router = useRouter();
  const redirectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const agentRef = process.env.NEXT_PUBLIC_AGENT_REF;

  // Stable fetcher function to prevent re-renders
  const plansFetcher = useCallback(async (agentRef: string) => {
    const response = await fetch(`/api/list-plans?agentRef=${agentRef}`);
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to fetch plans');
    }
    const data = await response.json();
    // Sort and limit to first 2 plans in fetcher
    const sortedPlans = (data.plans || []).sort(sortPlansByPrice).slice(0, 2);
    return sortedPlans;
  }, []);

  // Fetch plans using the SDK hook
  const {
    plans,
    loading,
    error,
    selectedPlanIndex,
    selectedPlan: currentPlan,
    setSelectedPlanIndex,
  } = usePlans({
    agentRef: agentRef || '',
    fetcher: plansFetcher,
    autoSelectFirstPaid: true,
  });

  // Use subscription status from SDK
  const subscriptionStatus = useSubscriptionStatus(plans);
  
  // Force refetch subscriptions when checkout page mounts (only once)
  const hasRefetchedRef = useRef(false);
  useEffect(() => {
    if (!hasRefetchedRef.current) {
      hasRefetchedRef.current = true;
      refetch().catch(() => {
        // Error handled silently
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Handle payment success
  const handlePaymentSuccess = async (paymentIntent?: any) => {
    // Check if payment processing timed out or had an error
    const isTimeout = paymentIntent?._processingTimeout === true;
    const hasError = !!paymentIntent?._processingError;
    
    // Refetch subscriptions before showing message
    await refetch();
    
    if (isTimeout || hasError) {
      if (isTimeout) {
        console.error('[CheckoutPage] Payment processing timed out - webhooks may not be configured');
      } else if (hasError) {
        console.error('[CheckoutPage] Payment processing failed:', paymentIntent?._processingError);
      }
      
      // Show failure message to user (no technical details)
      setPaymentFailed(true);
    } else {
      // Only set success if there was no timeout or error
      setPaymentSuccess(true);
      redirectTimeoutRef.current = setTimeout(() => {
        router.push('/');
      }, 2000);
    }
  };

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (redirectTimeoutRef.current) {
        clearTimeout(redirectTimeoutRef.current);
      }
    };
  }, []);

  // Handle payment error
  const handlePaymentError = (err: Error) => {
    console.error('[CheckoutPage] Payment error:', err.message);
    
    // Show failure message to user (no technical details)
    setShowPaymentForm(false);
    setPaymentFailed(true);
  };

  // Handle continue button click
  const handleContinue = () => {
    if (currentPlan?.price && currentPlan.price > 0) {
      setShowPaymentForm(true);
    }
  };

  // Handle cancel plan
  const handleCancelPlan = async () => {
    if (!confirm('Are you sure you want to cancel your plan?')) {
      return;
    }

    const { activePaidSubscription } = subscriptionStatus;

    if (!activePaidSubscription) {
      return;
    }

    if (activePaidSubscription.status !== 'active') {
      await refetch();
      return;
    }

    setIsCancelling(true);

    try {
      const accessToken = await getAccessToken();
      
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...(accessToken && { 'Authorization': `Bearer ${accessToken}` }),
      };

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
        console.error('Cancel subscription error:', errorMessage, errorData);
        throw new Error(errorMessage);
      }

      await res.json();
      await new Promise(resolve => setTimeout(resolve, 300));
      await refetch();
      window.location.href = '/';
    } catch (err) {
      console.error('Cancel subscription failed:', err);
      setIsCancelling(false);
    }
  };

  // Handle back to plan selection
  const handleBackToSelection = () => {
    setShowPaymentForm(false);
  };

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-2xl mx-auto px-6 py-12">
        <Link href="/" className="text-slate-600 hover:text-slate-900 mb-8 inline-block">
          ← Back
        </Link>

        {paymentFailed ? (
          <PaymentFailureMessage />
        ) : paymentSuccess ? (
          <SuccessMessage />
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
            <h2 className="text-xl font-semibold text-slate-900 mb-8">Choose your subscription</h2>

            {loading && (
              <div className="text-center py-8 text-slate-500">Loading plans...</div>
            )}

            {error && !loading && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-center">
                {error.message}
              </div>
            )}

            {!loading && !error && plans.length > 0 && currentPlan && currentPlan.reference && (
              <>
                {!showPaymentForm && (
                  <>
                    {/* Plan Selection Cards */}
                    <PlanSelectionSection
                      plans={plans}
                      selectedPlanIndex={selectedPlanIndex}
                      activePlanName={subscriptionStatus.activePlanName}
                      onSelectPlan={setSelectedPlanIndex}
                      className="mb-8"
                    />

                    {/* Payment Summary */}
                    <PaymentSummary selectedPlan={currentPlan} className="mb-8" />

                    {/* Cancelled Subscription Notice */}
                    <SubscriptionNotices
                      cancelledSubscription={subscriptionStatus.cancelledSubscription}
                      shouldShow={subscriptionStatus.shouldShowCancelledNotice}
                      className="mb-6"
                    />

                    {/* Action Buttons */}
                    <CheckoutActions
                      hasPaidSubscription={subscriptionStatus.hasPaidSubscription}
                      shouldShowCancelledNotice={subscriptionStatus.shouldShowCancelledNotice}
                      onContinue={handleContinue}
                      onCancel={handleCancelPlan}
                      isPreparingCheckout={false}
                      isCancelling={isCancelling}
                    />
                  </>
                )}

                {/* Payment Form - Only mount when needed */}
                {showPaymentForm && (
                  <PaymentFormSection
                    currentPlan={currentPlan}
                    agentRef={agentRef}
                    onSuccess={handlePaymentSuccess}
                    onError={handlePaymentError}
                    onBack={handleBackToSelection}
                  />
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
