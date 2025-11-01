"use client";
import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import type { 
  SolvaPayProviderProps, 
  SolvaPayContextValue, 
  SubscriptionStatus,
  CustomerSubscriptionData,
} from './types';

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

  // Sync internal customer ref with prop changes
  useEffect(() => {
    if (customerRef && customerRef !== internalCustomerRef) {
      setInternalCustomerRef(customerRef);
    }
  }, [customerRef, internalCustomerRef]);

  const fetchSubscription = useCallback(async () => {
    const currentCustomerRef = internalCustomerRef;
    
    if (!currentCustomerRef) {
      setSubscriptionData({ subscriptions: [] });
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const data = await checkSubscription(currentCustomerRef);

      setSubscriptionData(data);
    } catch (error) {
      console.error('❌ [SolvaPayProvider] Failed to fetch subscription:', error);
      // On error, set empty subscriptions
      // Error handling is left to the caller via error callbacks if needed
      setSubscriptionData({ 
        customerRef: currentCustomerRef,
        subscriptions: [] 
      });
    } finally {
      setLoading(false);
    }
  }, [internalCustomerRef, checkSubscription]);

  // Auto-fetch subscription when customerRef changes
  useEffect(() => {
    fetchSubscription();
  }, [fetchSubscription]);

  // Update customer ref method
  const updateCustomerRef = useCallback((newCustomerRef: string) => {
    const previousRef = internalCustomerRef;
    setInternalCustomerRef(newCustomerRef);
    if (onCustomerRefUpdate) {
      onCustomerRefUpdate(newCustomerRef);
    }
    // Only trigger refetch if the customer ref actually changed
    // The useEffect will handle refetching automatically when internalCustomerRef changes
    if (previousRef !== newCustomerRef) {
      // Don't call fetchSubscription directly - let the useEffect handle it
      // This prevents duplicate fetches
    }
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
    refetchSubscription: fetchSubscription,
    createPayment,
    customerRef: internalCustomerRef,
    updateCustomerRef,
  }), [subscription, fetchSubscription, createPayment, internalCustomerRef, updateCustomerRef]);

  return (
    <SolvaPayContext.Provider value={contextValue}>
      {children}
    </SolvaPayContext.Provider>
  );
};
