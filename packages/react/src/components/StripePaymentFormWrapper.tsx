"use client";
import React, { useState, FormEvent } from 'react';
import { useStripe, useElements, PaymentElement } from '@stripe/react-stripe-js';
import { Spinner } from './Spinner';

interface StripePaymentFormWrapperProps {
  onSuccess?: (paymentIntent: any) => void;
  onError?: (error: Error) => void;
  returnUrl?: string;
  submitButtonText?: string;
  buttonClassName?: string;
}

/**
 * Stripe Payment Form Wrapper Component
 * Renders inside Stripe Elements context and handles the payment flow
 * All hooks are called unconditionally to comply with React Rules of Hooks
 */
export const StripePaymentFormWrapper: React.FC<StripePaymentFormWrapperProps> = ({
  onSuccess,
  onError,
  returnUrl,
  submitButtonText = 'Pay Now',
  buttonClassName,
}) => {
  // Always call hooks unconditionally
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isPaymentElementReady, setIsPaymentElementReady] = useState(false);

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

  const isReady = !!(stripe && elements);

  return (
    <form 
      onSubmit={handleSubmit} 
      className="space-y-6"
      noValidate
    >
      {/* PaymentElement container with loading placeholder */}
      <div className="relative">
        {/* Loading placeholder - shown until PaymentElement is ready or Elements not ready */}
        {(!isPaymentElementReady || !isReady) && (
          <div className="absolute inset-0 z-10 p-4 bg-white border border-gray-300 rounded-lg min-h-[200px] flex items-center justify-center">
            <Spinner size="md" />
          </div>
        )}
        {/* PaymentElement - render only when Elements is ready; hide until ready to prevent flash */}
        {isReady && (
          <div className={isPaymentElementReady ? 'block' : 'opacity-0 pointer-events-none'}>
            <PaymentElement 
              onReady={() => setIsPaymentElementReady(true)}
            />
          </div>
        )}
      </div>
      
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
        disabled={!isReady || !isPaymentElementReady || isProcessing}
        className={buttonClassName}
        aria-busy={isProcessing || !isPaymentElementReady || !isReady}
        aria-disabled={!isReady || !isPaymentElementReady || isProcessing}
      >
        {isProcessing ? (
          <span className="flex items-center justify-center">
            <Spinner size="sm" />
          </span>
        ) : (!isReady || !isPaymentElementReady) ? (
          <span className="flex items-center justify-center">
            <Spinner size="sm" />
          </span>
        ) : (
          submitButtonText
        )}
      </button>
    </form>
  );
};

