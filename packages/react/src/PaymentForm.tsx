"use client";
import React, { useEffect, useCallback, useRef, useMemo, useState } from 'react';
import { Elements } from '@stripe/react-stripe-js';
import { useCheckout } from './hooks/useCheckout';
import { useSubscription } from './hooks/useSubscription';
import { useSolvaPay } from './hooks/useSolvaPay';
import { Spinner } from './components/Spinner';
import { StripePaymentFormWrapper } from './components/StripePaymentFormWrapper';
import type { PaymentFormProps } from './types';

/**
 * SolvaPay Payment Form Component
 * 
 * A simplified, minimal payment form that handles the checkout flow.
 * Automatically initializes Stripe and displays the payment form.
 * 
 * @example
 * ```tsx
 * import { PaymentForm } from '@solvapay/react';
 * 
 * <PaymentForm
 *   planRef="pro_plan"
 *   agentRef="agent_123"
 *   onSuccess={(paymentIntent) => {
 *     console.log('Payment successful!');
 *   }}
 *   onError={(error) => {
 *     console.error('Payment failed:', error);
 *   }}
 * />
 * ```
 */
export const PaymentForm: React.FC<PaymentFormProps> = ({
  planRef,
  agentRef,
  onSuccess,
  onError,
  returnUrl,
  submitButtonText = 'Pay Now',
  className,
  buttonClassName,
}) => {
  // CRITICAL: Always call hooks unconditionally FIRST, before any early returns
  // Use a safe fallback for planRef to ensure hooks always receive valid input
  const validPlanRef = planRef && typeof planRef === 'string' ? planRef : '';
  const checkout = useCheckout(validPlanRef);
  const { refetch } = useSubscription();
  const { processPayment, customerRef } = useSolvaPay();
  const hasInitializedRef = useRef(false);

  // Auto-start checkout on mount - only once
  useEffect(() => {
    if (!hasInitializedRef.current && validPlanRef && !checkout.loading && !checkout.error && !checkout.clientSecret) {
      hasInitializedRef.current = true;
      checkout.startCheckout().catch(() => {
        // Error handled by useCheckout hook
        hasInitializedRef.current = false; // Allow retry on error
      });
    }
    // Reset initialization flag if planRef changes
    if (validPlanRef && checkout.clientSecret) {
      hasInitializedRef.current = true;
    }
  }, [validPlanRef, checkout.loading, checkout.error, checkout.clientSecret, checkout.startCheckout]);

  // Handle successful payment
  const handleSuccess = useCallback(async (paymentIntent: any) => {
    // Process payment if we have the necessary data
    if (processPayment && customerRef && agentRef) {
      try {
        await processPayment({
          paymentIntentId: paymentIntent.id,
          agentRef: agentRef,
          customerRef: customerRef,
          planRef: planRef,
        });
        await refetch();
      } catch (error) {
        console.error('[PaymentForm] Failed to process payment:', error);
        // Payment succeeded but processing failed - webhook will handle it
        await refetch();
      }
    } else {
      // No processPayment available, refetch anyway (webhook might have processed)
      await refetch();
    }
    
    if (onSuccess) {
      onSuccess(paymentIntent);
    }
  }, [processPayment, customerRef, agentRef, planRef, refetch, onSuccess]);

  // Handle payment error
  const handleError = useCallback((err: Error) => {
    if (onError) {
      onError(err);
    }
  }, [onError]);

  // Auto-detect return URL if not provided
  const finalReturnUrl = returnUrl || (typeof window !== 'undefined' ? window.location.href : '/');

  // Validate planRef AFTER all hooks are called
  const isValidPlanRef = planRef && typeof planRef === 'string';

  // Determine render state
  const hasError = !!checkout.error;
  const hasStripeData = !!(checkout.stripePromise && checkout.clientSecret);

  // Memoize Elements options to maintain stable identity while clientSecret stays the same
  const elementsOptions = useMemo(() => {
    if (!checkout.clientSecret) return undefined;
    return { clientSecret: checkout.clientSecret };
  }, [checkout.clientSecret]);

  // Track if Elements has ever been mounted for this planRef to prevent unmounting
  // Reset when planRef changes (component will remount due to key prop)
  const [hasMountedElements, setHasMountedElements] = useState(false);
  
  // Update state when Stripe data becomes available
  useEffect(() => {
    if (hasStripeData) {
      setHasMountedElements(true);
    }
  }, [hasStripeData]);
  
  // Only mount Elements once we have both stripePromise and clientSecret
  // Once mounted, keep it mounted to maintain hook consistency
  const shouldRenderElements = hasStripeData || (hasMountedElements && checkout.stripePromise && checkout.clientSecret);

  // Always return the same JSX structure to maintain hook consistency
  // Once Elements is rendered, it should never unmount to avoid hook count issues
  return (
    <div className={className}>
      {!isValidPlanRef ? (
        <div className="p-4 bg-red-50 border border-red-400 rounded-lg text-red-700">
          PaymentForm: planRef is required and must be a string
        </div>
      ) : hasError ? (
        <div className="p-4 bg-red-50 border border-red-400 rounded-lg text-red-700">
          <div className="font-medium mb-1">Payment initialization failed</div>
          <div className="text-sm">{checkout.error?.message || 'Unknown error'}</div>
        </div>
      ) : shouldRenderElements && checkout.stripePromise && elementsOptions ? (
        // Once we have Stripe data, always render Elements to maintain hook consistency
        // This prevents hook count mismatches when transitioning between states
        <Elements
          key={checkout.clientSecret!}
          stripe={checkout.stripePromise}
          options={elementsOptions}
        >
          <StripePaymentFormWrapper
            onSuccess={handleSuccess}
            onError={handleError}
            returnUrl={finalReturnUrl}
            submitButtonText={submitButtonText}
            buttonClassName={buttonClassName}
          />
        </Elements>
      ) : (
        // Loading state before Stripe data is available
        <div className="space-y-4">
          <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-center min-h-[200px]">
            <Spinner size="md" />
          </div>
          <button
            disabled
            className={buttonClassName}
            aria-busy="true"
          >
            <span className="flex items-center justify-center gap-2">
              <Spinner size="sm" />
              {submitButtonText}
            </span>
          </button>
        </div>
      )}
    </div>
  );
};

