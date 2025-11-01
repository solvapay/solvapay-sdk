import { useState, useCallback, useRef } from 'react';
import { loadStripe, Stripe } from '@stripe/stripe-js';
import { useSolvaPay } from './useSolvaPay';

export interface UseCheckoutReturn {
  loading: boolean;
  error: Error | null;
  stripePromise: Promise<Stripe | null> | null;
  clientSecret: string | null;
  startCheckout: () => Promise<void>;
  reset: () => void;
}

/**
 * Hook to manage checkout flow
 * Handles payment intent creation and Stripe initialization
 * 
 * @param planRef - The plan reference to checkout
 */
export function useCheckout(planRef: string): UseCheckoutReturn {
  const { createPayment, customerRef, updateCustomerRef } = useSolvaPay();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(
    !planRef || typeof planRef !== 'string' 
      ? new Error('useCheckout: planRef parameter is required and must be a string')
      : null
  );
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const isStartingRef = useRef(false);

  const startCheckout = useCallback(async () => {
    // Prevent concurrent calls
    if (isStartingRef.current || loading) {
      return;
    }

    if (!planRef || typeof planRef !== 'string') {
      setError(new Error('useCheckout: planRef parameter is required and must be a string'));
      return;
    }

    if (!customerRef) {
      setError(new Error('No customer reference available. Please ensure you are logged in.'));
      return;
    }

    // Set guard flag
    isStartingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      // Create payment intent
      const result = await createPayment({ planRef, customerRef });

      // Validate payment intent result
      if (!result || typeof result !== 'object') {
        throw new Error('Invalid payment intent response from server');
      }

      if (!result.clientSecret || typeof result.clientSecret !== 'string') {
        throw new Error('Invalid client secret in payment intent response');
      }

      if (!result.publishableKey || typeof result.publishableKey !== 'string') {
        throw new Error('Invalid publishable key in payment intent response');
      }

      // If the backend returned a new customer reference, update it
      // This happens when a local customer ID is converted to a backend customer ID
      if (result.customerRef && result.customerRef !== customerRef) {
        console.log(`🔄 [useCheckout] Backend returned different customerRef:`, {
          sent: customerRef,
          received: result.customerRef,
        });
        if (updateCustomerRef) {
          updateCustomerRef(result.customerRef);
          console.log('✅ [useCheckout] Customer reference updated via callback');
        } else {
          console.warn('⚠️  [useCheckout] No updateCustomerRef callback available!');
        }
      } else if (result.customerRef === customerRef) {
        console.log('✅ [useCheckout] Customer reference unchanged:', customerRef);
      }

      // Load Stripe with the publishable key
      const stripeOptions = result.accountId 
        ? { stripeAccount: result.accountId }
        : {};
      
      const stripe = loadStripe(result.publishableKey, stripeOptions);
      
      setStripePromise(stripe);
      setClientSecret(result.clientSecret);
      
      // Note: We don't refetch here because payment intent creation doesn't change subscription status
      // Subscription only changes after successful payment completion, which is handled in PaymentForm
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to start checkout');
      setError(error);
    } finally {
      setLoading(false);
      isStartingRef.current = false; // Clear guard flag
    }
  }, [planRef, customerRef, createPayment, updateCustomerRef, loading]);

  const reset = useCallback(() => {
    isStartingRef.current = false;
    setLoading(false);
    setError(null);
    setStripePromise(null);
    setClientSecret(null);
  }, []);

  return {
    loading,
    error,
    stripePromise,
    clientSecret,
    startCheckout,
    reset,
  };
}

