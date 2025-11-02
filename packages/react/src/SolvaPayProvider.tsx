"use client";
import React, { createContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { 
  SolvaPayProviderProps, 
  SolvaPayContextValue, 
  SubscriptionStatus,
  CustomerSubscriptionData,
  SubscriptionInfo,
} from './types';
import { filterSubscriptions } from './utils/subscriptions';

export const SolvaPayContext = createContext<SolvaPayContextValue | null>(null);

/**
 * SolvaPay Provider - Headless Context Provider
 * 
 * Provides subscription state and payment methods to child components.
 * This is a headless provider that manages state without rendering UI.
 * 
 * @example
 * ```tsx
 * <SolvaPayProvider
 *   customerRef={user?.id}
 *   createPayment={async ({ planRef, customerRef }) => {
 *     const res = await fetch('/api/payments/create', {
 *       method: 'POST',
 *       body: JSON.stringify({ planRef, customerRef })
 *     });
 *     return res.json();
 *   }}
 *   checkSubscription={async (customerRef) => {
 *     const res = await fetch(`/api/subscriptions/${customerRef}`);
 *     return res.json();
 *   }}
 * >
 *   <App />
 * </SolvaPayProvider>
 * ```
 */
export const SolvaPayProvider: React.FC<SolvaPayProviderProps> = ({
  createPayment,
  checkSubscription,
  processPayment,
  customerRef,
  onCustomerRefUpdate,
  children,
}) => {
  // Validate required props
  if (!createPayment || typeof createPayment !== 'function') {
    throw new Error('SolvaPayProvider: createPayment prop is required and must be a function');
  }
  
  if (!checkSubscription || typeof checkSubscription !== 'function') {
    throw new Error('SolvaPayProvider: checkSubscription prop is required and must be a function');
  }

  const [subscriptionData, setSubscriptionData] = useState<CustomerSubscriptionData>({
    subscriptions: [],
  });
  const [loading, setLoading] = useState(false);
  const [internalCustomerRef, setInternalCustomerRef] = useState(customerRef);
  // Track in-flight requests to prevent duplicate calls
  const inFlightRef = useRef<string | null>(null);
  // Track what we've already fetched to prevent unnecessary refetches
  const lastFetchedRef = useRef<string | null>(null);
  // Store checkSubscription in a ref to avoid dependency issues
  const checkSubscriptionRef = useRef(checkSubscription);
  
  // Update ref when checkSubscription changes
  useEffect(() => {
    checkSubscriptionRef.current = checkSubscription;
  }, [checkSubscription]);

  // Fetch subscription function - memoized to prevent unnecessary re-renders
  const fetchSubscription = useCallback(async (force = false) => {
    const currentCustomerRef = internalCustomerRef;
    
    if (!currentCustomerRef) {
      setSubscriptionData({ subscriptions: [] });
      setLoading(false);
      inFlightRef.current = null;
      lastFetchedRef.current = null;
      return;
    }

    // Skip if we've already fetched this customerRef (unless it's in-flight or forced)
    if (!force && lastFetchedRef.current === currentCustomerRef && inFlightRef.current !== currentCustomerRef) {
      return;
    }

    // Prevent duplicate concurrent requests for the same customerRef
    if (inFlightRef.current === currentCustomerRef) {
      return;
    }

    inFlightRef.current = currentCustomerRef;
    setLoading(true);
    
    try {
      const data = await checkSubscriptionRef.current(currentCustomerRef);

      // Only update if this is still the current customerRef (might have changed during fetch)
      if (inFlightRef.current === currentCustomerRef) {
        // Filter subscriptions using shared utility
        const filteredData: CustomerSubscriptionData = {
          ...data,
          subscriptions: filterSubscriptions(data.subscriptions || []),
        };
        setSubscriptionData(filteredData);
        lastFetchedRef.current = currentCustomerRef;
      }
    } catch (error) {
      console.error('[SolvaPayProvider] Failed to fetch subscription:', error);
      // On error, set empty subscriptions
      if (inFlightRef.current === currentCustomerRef) {
        setSubscriptionData({ 
          customerRef: currentCustomerRef,
          subscriptions: [] 
        });
        lastFetchedRef.current = currentCustomerRef;
      }
    } finally {
      if (inFlightRef.current === currentCustomerRef) {
        setLoading(false);
        inFlightRef.current = null;
      }
    }
  }, [internalCustomerRef]); // Only depend on internalCustomerRef

  // Refetch subscription function - forces a fresh fetch by clearing cache
  const refetchSubscription = useCallback(async () => {
    // Clear both cache refs to force a completely fresh fetch
    // Clear inFlightRef to ensure we don't skip if there's a pending request
    const currentCustomerRef = internalCustomerRef;
    lastFetchedRef.current = null;
    inFlightRef.current = null;
    // Force a fresh fetch
    await fetchSubscription(true);
  }, [fetchSubscription, internalCustomerRef]);

  // Sync internal customer ref with prop changes
  useEffect(() => {
    if (customerRef !== internalCustomerRef) {
      setInternalCustomerRef(customerRef);
    }
  }, [customerRef, internalCustomerRef]);

  // Fetch subscription when customerRef changes - single effect, no double calls
  useEffect(() => {
    // Skip if empty customerRef
    if (!customerRef) {
      setSubscriptionData({ subscriptions: [] });
      setLoading(false);
      return;
    }

    // Skip if already fetched or in-flight
    if (customerRef === lastFetchedRef.current || customerRef === inFlightRef.current) {
      return;
    }

    // Fetch subscription directly using refs to avoid dependency issues
    const doFetch = async () => {
      inFlightRef.current = customerRef;
      setLoading(true);
      
      try {
        const data = await checkSubscriptionRef.current(customerRef);

        // Only update if this is still the current customerRef (might have changed during fetch)
        if (inFlightRef.current === customerRef) {
          // Filter subscriptions using shared utility
          const filteredData: CustomerSubscriptionData = {
            ...data,
            subscriptions: filterSubscriptions(data.subscriptions || []),
          };
          setSubscriptionData(filteredData);
          lastFetchedRef.current = customerRef;
        }
      } catch (error) {
        console.error('[SolvaPayProvider] Failed to fetch subscription:', error);
        // On error, set empty subscriptions
        if (inFlightRef.current === customerRef) {
          setSubscriptionData({ 
            customerRef: customerRef,
            subscriptions: [] 
          });
          lastFetchedRef.current = customerRef;
        }
      } finally {
        if (inFlightRef.current === customerRef) {
          setLoading(false);
          inFlightRef.current = null;
        }
      }
    };

    doFetch();
  }, [customerRef]); // Only depend on customerRef - use refs for everything else

  // Update customer ref method
  const updateCustomerRef = useCallback((newCustomerRef: string) => {
    const previousRef = internalCustomerRef;
    setInternalCustomerRef(newCustomerRef);
    if (onCustomerRefUpdate) {
      onCustomerRefUpdate(newCustomerRef);
    }
    // The useEffect will handle refetching automatically when internalCustomerRef changes
  }, [onCustomerRefUpdate, internalCustomerRef]);

  // Build subscription status with helper methods - memoized to prevent unnecessary re-renders
  const subscription: SubscriptionStatus = useMemo(() => ({
    loading,
    customerRef: subscriptionData.customerRef,
    email: subscriptionData.email,
    name: subscriptionData.name,
    subscriptions: subscriptionData.subscriptions,
    hasActiveSubscription: subscriptionData.subscriptions.some(
      sub => sub.status === 'active'
    ),
    hasPlan: (planName: string) => {
      return subscriptionData.subscriptions.some(
        sub => sub.planName.toLowerCase() === planName.toLowerCase() && sub.status === 'active'
      );
    },
  }), [loading, subscriptionData]);

  // Memoize context value to prevent unnecessary re-renders of consumers
  const contextValue: SolvaPayContextValue = useMemo(() => ({
    subscription,
    refetchSubscription,
    createPayment,
    processPayment,
    customerRef: internalCustomerRef,
    updateCustomerRef,
  }), [subscription, refetchSubscription, createPayment, processPayment, internalCustomerRef, updateCustomerRef]);

  return (
    <SolvaPayContext.Provider value={contextValue}>
      {children}
    </SolvaPayContext.Provider>
  );
};
