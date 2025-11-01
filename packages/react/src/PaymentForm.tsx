"use client";
import React, { useState, FormEvent, useEffect, Suspense, useRef } from 'react';
import { useStripe, useElements, PaymentElement, Elements } from '@stripe/react-stripe-js';
import { useCheckout } from './hooks/useCheckout';
import { useSubscription } from './hooks/useSubscription';
import type { PaymentFormProps } from './types';

/**
 * Simple spinner component using CSS animations
 */
const Spinner: React.FC<{ className?: string; size?: 'sm' | 'md' | 'lg' }> = ({ 
  className = '', 
  size = 'md' 
}) => {
  const sizeClasses = {
    sm: 'w-4 h-4 border-2',
    md: 'w-6 h-6 border-2',
    lg: 'w-8 h-8 border-2',
  };

  return (
    <div
      className={`inline-block border-gray-300 border-t-gray-600 rounded-full animate-spin ${sizeClasses[size]} ${className}`}
      role="status"
      aria-busy="true"
    />
  );
};

/**
 * Wrapper component that ensures Elements context is ready before rendering form
 * This component is only rendered inside Elements, so hooks should work
 */
const StripePaymentFormWrapper: React.FC<{
  onSuccess?: (paymentIntent: any) => void;
  onError?: (error: Error) => void;
  returnUrl?: string;
  submitButtonText?: string;
  buttonClassName?: string;
}> = (props) => {
  // These hooks are safe to call here because this component is only rendered inside Elements
  const stripe = useStripe();
  const elements = useElements();
  
  // Show loading state if Stripe is not ready yet
  if (!stripe || !elements) {
    return (
      <div className="space-y-4">
        <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-center">
          <Spinner size="md" />
        </div>
      </div>
    );
  }

  return <StripePaymentForm {...props} />;
};

/**
 * Internal payment form component that requires Stripe Elements context
 */
const StripePaymentForm: React.FC<{
  onSuccess?: (paymentIntent: any) => void;
  onError?: (error: Error) => void;
  returnUrl?: string;
  submitButtonText?: string;
  buttonClassName?: string;
}> = ({
  onSuccess,
  onError,
  returnUrl,
  submitButtonText = 'Pay Now',
  buttonClassName,
}) => {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    // Double-check Stripe availability (defensive programming)
    if (!stripe || !elements) {
      const errorMessage = 'Stripe is not available. Please refresh the page.';
      setMessage(errorMessage);
      if (onError) {
        onError(new Error(errorMessage));
      }
      return;
    }

    setIsProcessing(true);
    setMessage(null);

    try {
      // Auto-detect return URL if not provided
      const finalReturnUrl = returnUrl || (typeof window !== 'undefined' ? window.location.href : '/');
      
      // Confirm payment with Stripe
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: finalReturnUrl,
        },
        redirect: 'if_required' as const, // Only redirect if required by payment method
      });

      if (error) {
        // Show error to customer (e.g., payment details are invalid)
        const errorMessage = error.message || 'An unexpected error occurred.';
        setMessage(errorMessage);
        
        if (onError) {
          onError(new Error(errorMessage));
        }
      } else if (paymentIntent && paymentIntent.status === 'succeeded') {
        // Payment succeeded
        setMessage('Payment successful!');
        
        if (onSuccess) {
          onSuccess(paymentIntent);
        }
      } else if (paymentIntent) {
        // Payment is processing or requires additional action
        setMessage(`Payment status: ${paymentIntent.status || 'processing'}`);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error occurred');
      setMessage(error.message);
      
      if (onError) {
        onError(error);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const isSuccess = message?.includes('successful') ?? false;

  return (
    <form 
      onSubmit={handleSubmit} 
      className="space-y-6"
      noValidate
    >
      <PaymentElement />
      
      {message && (
        <div
          className={`mt-6 p-4 rounded-lg ${
            isSuccess 
              ? 'bg-green-50 border border-green-400 text-green-700' 
              : 'bg-red-50 border border-red-400 text-red-700'
          }`}
          role={isSuccess ? 'status' : 'alert'}
          aria-live={isSuccess ? 'polite' : 'assertive'}
          aria-atomic="true"
        >
          {message}
        </div>
      )}
      
      <button
        type="submit"
        disabled={!stripe || isProcessing}
        className={buttonClassName}
        aria-busy={isProcessing}
        aria-disabled={!stripe || isProcessing}
      >
        {isProcessing ? (
          <span className="flex items-center justify-center gap-2">
            <Spinner size="sm" />
          </span>
        ) : (
          submitButtonText
        )}
      </button>
    </form>
  );
};

/**
 * SolvaPay Payment Form Component
 * 
 * Handles the entire checkout flow internally including Stripe initialization,
 * payment intent creation, and form rendering. Simply provide a planRef and
 * handle success/error callbacks.
 * 
 * @example
 * ```tsx
 * import { PaymentForm } from '@solvapay/react';
 * 
 * <PaymentForm
 *   planRef="pro_plan"
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
  onSuccess,
  onError,
  returnUrl,
  submitButtonText = 'Pay Now',
  className,
  buttonClassName,
  initialButtonText,
  cancelButtonText = 'Cancel',
}) => {
  // Ensure planRef is valid - use empty string as fallback to avoid hook errors
  const validPlanRef = planRef && typeof planRef === 'string' ? planRef : '';
  
  // Always call hooks unconditionally
  const { loading, error, stripePromise, clientSecret, startCheckout, reset } = useCheckout(validPlanRef);
  const { refetch } = useSubscription();
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [hasStartedCheckout, setHasStartedCheckout] = useState(false);
  const initializationKey = useRef<string>('');

  // Show error if planRef is invalid (but hooks were already called)
  const planRefError = !planRef || typeof planRef !== 'string' 
    ? new Error('PaymentForm: planRef is required')
    : null;

  // Show error if planRef is invalid
  if (planRefError) {
    return (
      <div className={className}>
        <div className="mt-4 p-4 bg-red-50 border border-red-400 rounded-lg text-red-700">
          {planRefError.message}
        </div>
      </div>
    );
  }

  // Initialize checkout once per planRef change
  useEffect(() => {
    const key = `${planRef}-${initialButtonText}`;
    
    // Skip if already initialized for this key
    if (initializationKey.current === key) {
      return;
    }
    
    // Reset form state
    setShowPaymentForm(false);
    setHasStartedCheckout(false);
    reset();
    
    // Mark as initialized
    initializationKey.current = key;

    // Auto-start checkout if no initialButtonText
    // Use requestAnimationFrame instead of setTimeout for better timing
    if (!initialButtonText && planRef && !loading && !error) {
      requestAnimationFrame(() => {
        setHasStartedCheckout(true);
        startCheckout().then(() => {
          setShowPaymentForm(true);
        }).catch(() => {
          // Error handled by useCheckout hook
        });
      });
    }
    // Note: startCheckout intentionally excluded from dependencies - guard in useCheckout prevents issues
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planRef, initialButtonText, loading, error, reset]);

  const handleStartCheckout = async () => {
    setHasStartedCheckout(true);
    await startCheckout();
    setShowPaymentForm(true);
  };

  const handleSuccess = async (paymentIntent: any) => {
    setShowPaymentForm(false);
    reset();
    await refetch();
    if (onSuccess) {
      onSuccess(paymentIntent);
    }
  };

  const handleCancel = () => {
    setShowPaymentForm(false);
    reset();
  };

  const handleError = (err: Error) => {
    if (onError) {
      onError(err);
    }
  };

  // Auto-detect return URL if not provided
  const finalReturnUrl = returnUrl || (typeof window !== 'undefined' ? window.location.href : '/');

  // Show payment form when ready (automatically show if no initialButtonText, otherwise wait for showPaymentForm)
  const shouldShowForm = (!initialButtonText || showPaymentForm) && stripePromise && clientSecret;
  
  if (shouldShowForm) {
    return (
      <div className={className}>
        <Suspense fallback={
          <div className="space-y-4">
            <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-center">
              <Spinner size="md" />
            </div>
          </div>
        }>
          <Elements 
            key={clientSecret} 
            stripe={stripePromise} 
            options={{ clientSecret }}
          >
            <StripePaymentFormWrapper
              onSuccess={handleSuccess}
              onError={handleError}
              returnUrl={finalReturnUrl}
              submitButtonText={submitButtonText}
              buttonClassName={buttonClassName}
            />
          </Elements>
        </Suspense>
        {cancelButtonText && (
          <button
            onClick={handleCancel}
            type="button"
            className="mt-6 w-full px-4 py-2 text-xs text-slate-600 bg-transparent rounded-full hover:text-slate-900 hover:bg-slate-50 font-medium transition-all duration-200"
          >
            {cancelButtonText}
          </button>
        )}
      </div>
    );
  }

  // Show loading or error state
  return (
    <div className={className}>
      {loading && (
        <div className="space-y-4">
          <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-center">
            <Spinner size="md" />
          </div>
          {initialButtonText && (
            <button
              disabled
              className={buttonClassName}
              aria-busy="true"
            >
              <span className="flex items-center justify-center gap-2">
                <Spinner size="sm" />
              </span>
            </button>
          )}
        </div>
      )}
      
      {error && (
        <>
          {initialButtonText && (
            <button
              onClick={() => {
                reset();
                handleStartCheckout();
              }}
              className={buttonClassName}
            >
              {initialButtonText}
            </button>
          )}
          <div className="mt-4 p-4 bg-red-50 border border-red-400 rounded-lg text-red-700">
            {error.message}
          </div>
        </>
      )}
      
      {!loading && !error && initialButtonText && (
        <button
          onClick={handleStartCheckout}
          className={buttonClassName}
        >
          {initialButtonText}
        </button>
      )}
    </div>
  );
};

