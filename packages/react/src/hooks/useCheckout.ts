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

// Cache Stripe promises per publishable key + accountId combination
// This allows reusing Stripe instances across checkout sessions with the same key
const stripePromiseCache = new Map<string, Promise<Stripe | null>>();

function getStripeCacheKey(publishableKey: string, accountId?: string): string {
  return accountId ? `${publishableKey}:${accountId}` : publishableKey;
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

    // Set guard flag
    isStartingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      // Create payment intent (customerRef is handled internally by provider)
      const result = await createPayment({ planRef });

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
      if (result.customerRef && result.customerRef !== customerRef && updateCustomerRef) {
        updateCustomerRef(result.customerRef);
      }

      // Load Stripe with the publishable key (use cache if available)
      const stripeOptions = result.accountId 
        ? { stripeAccount: result.accountId }
        : {};
      
      const cacheKey = getStripeCacheKey(result.publishableKey, result.accountId);
      let stripe = stripePromiseCache.get(cacheKey);
      
      if (!stripe) {
        // LoadStripe already caches internally, but we cache the promise here too
        // to avoid recreating it if we've seen this key before
        stripe = loadStripe(result.publishableKey, stripeOptions);
        stripePromiseCache.set(cacheKey, stripe);
      }
      
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
  }, [planRef, createPayment, updateCustomerRef, loading]);

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

