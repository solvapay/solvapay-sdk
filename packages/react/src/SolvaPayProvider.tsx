"use client";
import React, { createContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { 
  SolvaPayProviderProps, 
  SolvaPayContextValue, 
  SubscriptionStatus,
  CustomerSubscriptionData,
  PaymentIntentResult,
  SolvaPayConfig,
} from './types';
import type { ProcessPaymentResult } from '@solvapay/server';
import { filterSubscriptions, isPaidSubscription, getPrimarySubscription } from './utils/subscriptions';
import { defaultAuthAdapter, type AuthAdapter } from './adapters/auth';


export const SolvaPayContext = createContext<SolvaPayContextValue | null>(null);

// localStorage cache keys
const CUSTOMER_REF_KEY = 'solvapay_customerRef';
const CUSTOMER_REF_EXPIRY = 'solvapay_customerRef_expiry';
const CUSTOMER_REF_USER_ID_KEY = 'solvapay_customerRef_userId'; // Track which userId this customerRef belongs to
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Get cached customer reference from localStorage
 * Only returns it if it belongs to the current userId (if provided)
 */
function getCachedCustomerRef(userId?: string | null): string | null {
  if (typeof window === 'undefined') return null;
  
  const cached = localStorage.getItem(CUSTOMER_REF_KEY);
  const expiry = localStorage.getItem(CUSTOMER_REF_EXPIRY);
  const cachedUserId = localStorage.getItem(CUSTOMER_REF_USER_ID_KEY);
  
  if (!cached || !expiry) return null;
  
  if (Date.now() > parseInt(expiry)) {
    localStorage.removeItem(CUSTOMER_REF_KEY);
    localStorage.removeItem(CUSTOMER_REF_EXPIRY);
    localStorage.removeItem(CUSTOMER_REF_USER_ID_KEY);
    return null;
  }
  
  // CRITICAL: If userId is provided, only return cached customerRef if it belongs to this userId
  // This prevents using a customerRef from a different user after sign out/sign in
  if (userId !== undefined && userId !== null) {
    if (cachedUserId !== userId) {
      // CustomerRef belongs to a different user - clear it
      clearCachedCustomerRef();
      return null;
    }
  }
  
  return cached;
}

/**
 * Set cached customer reference in localStorage
 * Also stores the userId to prevent cross-user contamination
 * 
 * SECURITY: If userId is not provided, we don't cache the customerRef
 * This prevents caching customerRef for unauthenticated users or during auth transitions
 */
function setCachedCustomerRef(customerRef: string, userId?: string | null): void {
  if (typeof window === 'undefined') return;
  
  // SECURITY: Only cache customerRef if we have a userId to associate it with
  // This prevents cross-user contamination and ensures we can validate ownership
  if (userId === undefined || userId === null) {
    // Don't cache if no userId - this prevents security issues
    return;
  }
  
  localStorage.setItem(CUSTOMER_REF_KEY, customerRef);
  localStorage.setItem(CUSTOMER_REF_EXPIRY, String(Date.now() + CACHE_DURATION));
  localStorage.setItem(CUSTOMER_REF_USER_ID_KEY, userId);
}

/**
 * Clear cached customer reference from localStorage
 */
function clearCachedCustomerRef(): void {
  if (typeof window === 'undefined') return;
  
  localStorage.removeItem(CUSTOMER_REF_KEY);
  localStorage.removeItem(CUSTOMER_REF_EXPIRY);
  localStorage.removeItem(CUSTOMER_REF_USER_ID_KEY);
}

/**
 * Get the auth adapter to use (adapter > deprecated functions > default)
 */
function getAuthAdapter(config: SolvaPayConfig | undefined): AuthAdapter {
  // Use adapter if provided (preferred)
  if (config?.auth?.adapter) {
    return config.auth.adapter;
  }
  
  // Support deprecated getToken/getUserId functions for backward compatibility
  if (config?.auth?.getToken || config?.auth?.getUserId) {
    return {
      async getToken() {
        return config?.auth?.getToken?.() || null;
      },
      async getUserId() {
        return config?.auth?.getUserId?.() || null;
      },
    };
  }
  
  // Default adapter (localStorage only)
  return defaultAuthAdapter;
}

/**
 * SolvaPay Provider - Headless Context Provider
 * 
 * Provides subscription state and payment methods to child components.
 * Supports zero-config with sensible defaults, or full customization.
 * 
 * @example
 * ```tsx
 * // Zero config (uses defaults)
 * <SolvaPayProvider>
 *   <App />
 * </SolvaPayProvider>
 * 
 * // Custom API routes
 * <SolvaPayProvider
 *   config={{
 *     api: {
 *       checkSubscription: '/custom/api/subscription',
 *       createPayment: '/custom/api/payment'
 *     }
 *   }}
 * >
 *   <App />
 * </SolvaPayProvider>
 * 
 * // Fully custom
 * <SolvaPayProvider
 *   checkSubscription={async () => {
 *     return await myCustomAPI.checkSubscription();
 *   }}
 *   createPayment={async ({ planRef, agentRef }) => {
 *     return await myCustomAPI.createPayment(planRef, agentRef);
 *   }}
 * >
 *   <App />
 * </SolvaPayProvider>
 * ```
 */
export const SolvaPayProvider: React.FC<SolvaPayProviderProps> = ({
  config,
  createPayment: customCreatePayment,
  checkSubscription: customCheckSubscription,
  processPayment: customProcessPayment,
  children,
}) => {
  const [subscriptionData, setSubscriptionData] = useState<CustomerSubscriptionData>({
    subscriptions: [],
  });
  const [loading, setLoading] = useState(false);
  const [internalCustomerRef, setInternalCustomerRef] = useState<string | undefined>(undefined);
  const [userId, setUserId] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  
  // Track in-flight requests to prevent duplicate calls
  const inFlightRef = useRef<string | null>(null);
  // Track what we've already fetched to prevent unnecessary refetches
  const lastFetchedRef = useRef<string | null>(null);
  
  // Store functions in refs to avoid dependency issues
  const checkSubscriptionRef = useRef<(() => Promise<CustomerSubscriptionData>) | null>(null);
  const createPaymentRef = useRef<((params: { planRef: string; agentRef?: string }) => Promise<PaymentIntentResult>) | null>(null);
  const processPaymentRef = useRef<((params: {
    paymentIntentId: string;
    agentRef: string;
    planRef?: string;
  }) => Promise<ProcessPaymentResult>) | null>(null);
  const configRef = useRef(config);
  const buildDefaultCheckSubscriptionRef = useRef<(() => Promise<CustomerSubscriptionData>) | null>(null);
  
  // Update refs when props change
  useEffect(() => {
    configRef.current = config;
  }, [config]);
  
  useEffect(() => {
    checkSubscriptionRef.current = customCheckSubscription || null;
  }, [customCheckSubscription]);
  
  useEffect(() => {
    createPaymentRef.current = customCreatePayment || null;
  }, [customCreatePayment]);
  
  useEffect(() => {
    processPaymentRef.current = customProcessPayment || null;
  }, [customProcessPayment]);

  // Build default checkSubscription implementation - store in ref to keep it stable
  const buildDefaultCheckSubscription = useCallback(async (): Promise<CustomerSubscriptionData> => {
    const currentConfig = configRef.current;
    const adapter = getAuthAdapter(currentConfig);
    const token = await adapter.getToken();
    const detectedUserId = await adapter.getUserId();
    const route = currentConfig?.api?.checkSubscription || '/api/check-subscription';
    const fetchFn = currentConfig?.fetch || fetch;
    
    // Get cached customerRef from localStorage, validated against current userId
    const cachedRef = getCachedCustomerRef(detectedUserId);
    
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };
    
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    if (cachedRef) {
      headers['x-solvapay-customer-ref'] = cachedRef;
    }
    
    // Add custom headers
    if (currentConfig?.headers) {
      const customHeaders = typeof currentConfig.headers === 'function' 
        ? await currentConfig.headers()
        : currentConfig.headers;
      Object.assign(headers, customHeaders);
    }
    
    const res = await fetchFn(route, {
      method: 'GET',
      headers,
    });
    
    if (!res.ok) {
      const error = new Error(`Failed to check subscription: ${res.statusText}`);
      currentConfig?.onError?.(error, 'checkSubscription');
      throw error;
    }
    
    return res.json();
  }, []);
  
  // Store in ref so it doesn't need to be in dependency arrays
  useEffect(() => {
    buildDefaultCheckSubscriptionRef.current = buildDefaultCheckSubscription;
  }, [buildDefaultCheckSubscription]);

  // Build default createPayment implementation
  const buildDefaultCreatePayment = useCallback(async (params: { planRef: string; agentRef?: string }): Promise<PaymentIntentResult> => {
    const currentConfig = configRef.current;
    const adapter = getAuthAdapter(currentConfig);
    const token = await adapter.getToken();
    const detectedUserId = await adapter.getUserId();
    const route = currentConfig?.api?.createPayment || '/api/create-payment-intent';
    const fetchFn = currentConfig?.fetch || fetch;
    
    // Get cached customerRef from localStorage, validated against current userId
    const cachedRef = getCachedCustomerRef(detectedUserId);
    
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };
    
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    if (cachedRef) {
      headers['x-solvapay-customer-ref'] = cachedRef;
    }
    
    // Add custom headers
    if (currentConfig?.headers) {
      const customHeaders = typeof currentConfig.headers === 'function'
        ? await currentConfig.headers()
        : currentConfig.headers;
      Object.assign(headers, customHeaders);
    }
    
    // Build request body with planRef and agentRef if provided
    const body: { planRef: string; agentRef?: string } = { planRef: params.planRef };
    if (params.agentRef) {
      body.agentRef = params.agentRef;
    }
    
    const res = await fetchFn(route, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    
    if (!res.ok) {
      const error = new Error(`Failed to create payment: ${res.statusText}`);
      currentConfig?.onError?.(error, 'createPayment');
      throw error;
    }
    
    return res.json();
  }, []);

  // Build default processPayment implementation
  const buildDefaultProcessPayment = useCallback(async (params: {
    paymentIntentId: string;
    agentRef: string;
    planRef?: string;
  }): Promise<any> => {
    const currentConfig = configRef.current;
    const adapter = getAuthAdapter(currentConfig);
    const token = await adapter.getToken();
    const detectedUserId = await adapter.getUserId();
    const route = currentConfig?.api?.processPayment || '/api/process-payment';
    const fetchFn = currentConfig?.fetch || fetch;
    
    // Get cached customerRef from localStorage, validated against current userId
    const cachedRef = getCachedCustomerRef(detectedUserId);
    
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };
    
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    if (cachedRef) {
      headers['x-solvapay-customer-ref'] = cachedRef;
    }
    
    // Add custom headers
    if (currentConfig?.headers) {
      const customHeaders = typeof currentConfig.headers === 'function'
        ? await currentConfig.headers()
        : currentConfig.headers;
      Object.assign(headers, customHeaders);
    }
    
    const res = await fetchFn(route, {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
    });
    
    if (!res.ok) {
      const error = new Error(`Failed to process payment: ${res.statusText}`);
      currentConfig?.onError?.(error, 'processPayment');
      throw error;
    }
    
    return res.json();
  }, []);

  // Get the actual functions to use (priority: custom > config > defaults)
  // Use refs to avoid dependency issues - this keeps the function stable
  const checkSubscription = useCallback(async (): Promise<CustomerSubscriptionData> => {
    if (checkSubscriptionRef.current) {
      return checkSubscriptionRef.current();
    }
    if (buildDefaultCheckSubscriptionRef.current) {
      return buildDefaultCheckSubscriptionRef.current();
    }
    // Fallback (shouldn't happen, but TypeScript needs it)
    return buildDefaultCheckSubscription();
  }, []);

  const createPayment = useCallback(async (params: { planRef: string; agentRef?: string }): Promise<PaymentIntentResult> => {
    if (createPaymentRef.current) {
      return createPaymentRef.current(params);
    }
    return buildDefaultCreatePayment(params);
  }, [buildDefaultCreatePayment]);

  const processPayment = useCallback(async (params: {
    paymentIntentId: string;
    agentRef: string;
    planRef?: string;
  }): Promise<any> => {
    if (processPaymentRef.current) {
      return processPaymentRef.current(params);
    }
    return buildDefaultProcessPayment(params);
  }, [buildDefaultProcessPayment]);

  // Detect authentication state and user ID
  useEffect(() => {
    const detectAuth = async () => {
      const currentConfig = configRef.current;
      const adapter = getAuthAdapter(currentConfig);
      
      const token = await adapter.getToken();
      const detectedUserId = await adapter.getUserId();
      
      // Track previous userId to detect user changes
      const prevUserId = userId;
      
      setIsAuthenticated(!!token);
      setUserId(detectedUserId);
      
      // CRITICAL: Clear customerRef cache if userId changes (user switched accounts)
      // This prevents purchasing for the wrong user
      if (prevUserId !== null && detectedUserId !== prevUserId) {
        clearCachedCustomerRef();
        setInternalCustomerRef(undefined);
        return;
      }
      
      // If we have a cached customerRef and are authenticated, validate it belongs to current user
      const cachedRef = getCachedCustomerRef(detectedUserId);
      if (cachedRef && token) {
        setInternalCustomerRef(cachedRef);
      } else if (!token) {
        // Clear cache on sign-out
        clearCachedCustomerRef();
        setInternalCustomerRef(undefined);
      } else if (token && !cachedRef) {
        // Authenticated but no valid cached customerRef - clear internal ref
        setInternalCustomerRef(undefined);
      }
    };
    
    detectAuth();
    
    // Set up polling to detect auth changes (e.g., token refresh)
    const interval = setInterval(detectAuth, 5000); // Check every 5 seconds
    
    return () => clearInterval(interval);
  }, [userId]); // Include userId in deps to detect changes

  // Fetch subscription function - memoized to prevent unnecessary re-renders
  // Use refs for checkSubscription to avoid dependency issues
  const fetchSubscription = useCallback(async (force = false) => {
    // Only fetch if authenticated or if we have a customerRef
    if (!isAuthenticated && !internalCustomerRef) {
      setSubscriptionData({ subscriptions: [] });
      setLoading(false);
      inFlightRef.current = null;
      lastFetchedRef.current = null;
      return;
    }
    
    const cacheKey = internalCustomerRef || userId || 'anonymous';
    
    // Skip if we've already fetched this cacheKey (unless it's in-flight or forced)
    if (!force && lastFetchedRef.current === cacheKey && inFlightRef.current !== cacheKey) {
      return;
    }

    // Prevent duplicate concurrent requests for the same cacheKey
    if (inFlightRef.current === cacheKey) {
      return;
    }

    inFlightRef.current = cacheKey;
    setLoading(true);
    
    try {
      // Use ref to get the current checkSubscription function
      const checkFn = checkSubscriptionRef.current || buildDefaultCheckSubscriptionRef.current;
      if (!checkFn) {
        throw new Error('checkSubscription function not available');
      }
      const data = await checkFn();

      // Store customerRef from response if available
      // Only cache if we have a userId to prevent cross-user contamination
      if (data.customerRef) {
        setInternalCustomerRef(data.customerRef);
        // Get current userId to associate with customerRef
        const currentAdapter = getAuthAdapter(configRef.current);
        const currentUserId = await currentAdapter.getUserId();
        setCachedCustomerRef(data.customerRef, currentUserId);
      }

      // Only update if this is still the current cacheKey (might have changed during fetch)
      if (inFlightRef.current === cacheKey) {
        // Filter subscriptions using shared utility
        const filteredData: CustomerSubscriptionData = {
          ...data,
          subscriptions: filterSubscriptions(data.subscriptions || []),
        };
        
        setSubscriptionData(filteredData);
        lastFetchedRef.current = cacheKey;
      }
    } catch (error) {
      console.error('[SolvaPayProvider] Failed to fetch subscription:', error);
      // On error, set empty subscriptions
      if (inFlightRef.current === cacheKey) {
        setSubscriptionData({ 
          subscriptions: [] 
        });
        lastFetchedRef.current = cacheKey;
      }
    } finally {
      if (inFlightRef.current === cacheKey) {
        setLoading(false);
        inFlightRef.current = null;
      }
    }
  }, [isAuthenticated, internalCustomerRef, userId]);

  // Refetch subscription function - forces a fresh fetch by clearing cache
  // Use ref to get fetchSubscription to avoid dependency issues
  const fetchSubscriptionRef = useRef(fetchSubscription);
  useEffect(() => {
    fetchSubscriptionRef.current = fetchSubscription;
  }, [fetchSubscription]);
  
  const refetchSubscription = useCallback(async () => {
    // Always clear cache state before refetching to ensure fresh data
    // Clear both the cache key tracking and in-flight requests
    lastFetchedRef.current = null;
    inFlightRef.current = null;
    
    // Also clear subscription data temporarily to ensure UI reflects loading state
    // This prevents showing stale data while fetching
    setSubscriptionData({ subscriptions: [] });
    
    // Force a fresh fetch by passing force=true
    // This bypasses the cache check and ensures we get the latest data from the server
    await fetchSubscriptionRef.current(true);
  }, []);

  // Auto-fetch subscriptions on mount and when auth state changes
  // Only depend on actual values, not the function itself
  useEffect(() => {
    // Clear cache when userId or customerRef changes to prevent stale data
    // This is important when switching accounts or when customerRef is updated
    lastFetchedRef.current = null;
    inFlightRef.current = null;
    
    if (isAuthenticated || internalCustomerRef) {
      fetchSubscription();
    } else {
      setSubscriptionData({ subscriptions: [] });
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, internalCustomerRef, userId]);

  // Update customer ref method
  const updateCustomerRef = useCallback((newCustomerRef: string) => {
    setInternalCustomerRef(newCustomerRef);
    // Store with current userId to prevent cross-user contamination
    setCachedCustomerRef(newCustomerRef, userId);
    // Trigger refetch
    fetchSubscription(true);
  }, [fetchSubscription, userId]);

  // Build subscription status with helper methods - memoized to prevent unnecessary re-renders
  const subscription: SubscriptionStatus = useMemo(() => {
    // Get primary active subscription (paid or free) - most recent active subscription
    const activeSubscription = getPrimarySubscription(subscriptionData.subscriptions);
    
    // Compute active paid subscriptions
    // Backend keeps subscriptions as 'active' until expiration, even when cancelled
    const activePaidSubscriptions = subscriptionData.subscriptions.filter(
      sub => sub.status === 'active' && isPaidSubscription(sub)
    );
    
    // Get most recent active paid subscription (sorted by startDate)
    const activePaidSubscription = activePaidSubscriptions
      .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())[0] || null;
    
    return {
      loading,
      customerRef: subscriptionData.customerRef || internalCustomerRef,
      email: subscriptionData.email,
      name: subscriptionData.name,
      subscriptions: subscriptionData.subscriptions,
      hasPlan: (planName: string) => {
        return subscriptionData.subscriptions.some(
          sub => sub.planName.toLowerCase() === planName.toLowerCase() && sub.status === 'active'
        );
      },
      activeSubscription,
      hasPaidSubscription: activePaidSubscriptions.length > 0,
      activePaidSubscription,
    };
  }, [loading, subscriptionData, internalCustomerRef]);

  // Memoize context value to prevent unnecessary re-renders of consumers
  const contextValue: SolvaPayContextValue = useMemo(() => ({
    subscription,
    refetchSubscription,
    createPayment,
    processPayment,
    customerRef: subscriptionData.customerRef || internalCustomerRef,
    updateCustomerRef,
  }), [subscription, refetchSubscription, createPayment, processPayment, subscriptionData.customerRef, internalCustomerRef, updateCustomerRef]);

  return (
    <SolvaPayContext.Provider value={contextValue}>
      {children}
    </SolvaPayContext.Provider>
  );
};
