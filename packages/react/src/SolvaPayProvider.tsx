'use client'
import React, { createContext, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type {
  SolvaPayProviderProps,
  SolvaPayContextValue,
  PurchaseStatus,
  CustomerPurchaseData,
  PaymentIntentResult,
  SolvaPayConfig,
} from './types'
import type { ProcessPaymentResult } from '@solvapay/server'
import {
  filterPurchases,
  isPaidPurchase,
  getPrimaryPurchase,
} from './utils/purchases'
import { defaultAuthAdapter, type AuthAdapter } from './adapters/auth'

export const SolvaPayContext = createContext<SolvaPayContextValue | null>(null)

// localStorage cache keys
const CUSTOMER_REF_KEY = 'solvapay_customerRef'
const CUSTOMER_REF_EXPIRY = 'solvapay_customerRef_expiry'
const CUSTOMER_REF_USER_ID_KEY = 'solvapay_customerRef_userId' // Track which userId this customerRef belongs to
const CACHE_DURATION = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Get cached customer reference from localStorage
 * Only returns it if it belongs to the current userId (if provided)
 */
function getCachedCustomerRef(userId?: string | null): string | null {
  if (typeof window === 'undefined') return null

  const cached = localStorage.getItem(CUSTOMER_REF_KEY)
  const expiry = localStorage.getItem(CUSTOMER_REF_EXPIRY)
  const cachedUserId = localStorage.getItem(CUSTOMER_REF_USER_ID_KEY)

  if (!cached || !expiry) return null

  if (Date.now() > parseInt(expiry)) {
    localStorage.removeItem(CUSTOMER_REF_KEY)
    localStorage.removeItem(CUSTOMER_REF_EXPIRY)
    localStorage.removeItem(CUSTOMER_REF_USER_ID_KEY)
    return null
  }

  // CRITICAL: If userId is provided, only return cached customerRef if it belongs to this userId
  // This prevents using a customerRef from a different user after sign out/sign in
  if (userId !== undefined && userId !== null) {
    if (cachedUserId !== userId) {
      // CustomerRef belongs to a different user - clear it
      clearCachedCustomerRef()
      return null
    }
  }

  return cached
}

/**
 * Set cached customer reference in localStorage
 * Also stores the userId to prevent cross-user contamination
 *
 * SECURITY: If userId is not provided, we don't cache the customerRef
 * This prevents caching customerRef for unauthenticated users or during auth transitions
 */
function setCachedCustomerRef(customerRef: string, userId?: string | null): void {
  if (typeof window === 'undefined') return

  // SECURITY: Only cache customerRef if we have a userId to associate it with
  // This prevents cross-user contamination and ensures we can validate ownership
  if (userId === undefined || userId === null) {
    // Don't cache if no userId - this prevents security issues
    return
  }

  localStorage.setItem(CUSTOMER_REF_KEY, customerRef)
  localStorage.setItem(CUSTOMER_REF_EXPIRY, String(Date.now() + CACHE_DURATION))
  localStorage.setItem(CUSTOMER_REF_USER_ID_KEY, userId)
}

/**
 * Clear cached customer reference from localStorage
 */
function clearCachedCustomerRef(): void {
  if (typeof window === 'undefined') return

  localStorage.removeItem(CUSTOMER_REF_KEY)
  localStorage.removeItem(CUSTOMER_REF_EXPIRY)
  localStorage.removeItem(CUSTOMER_REF_USER_ID_KEY)
}

/**
 * Get the auth adapter to use (adapter > deprecated functions > default)
 */
function getAuthAdapter(config: SolvaPayConfig | undefined): AuthAdapter {
  // Use adapter if provided (preferred)
  if (config?.auth?.adapter) {
    return config.auth.adapter
  }

  // Support deprecated getToken/getUserId functions for backward compatibility
  if (config?.auth?.getToken || config?.auth?.getUserId) {
    return {
      async getToken() {
        return config?.auth?.getToken?.() || null
      },
      async getUserId() {
        return config?.auth?.getUserId?.() || null
      },
    }
  }

  // Default adapter (localStorage only)
  return defaultAuthAdapter
}

/**
 * SolvaPay Provider - Headless Context Provider for React.
 *
 * Provides purchase state, payment methods, and customer data to child components
 * via React Context. This is the root component that must wrap your app to use
 * SolvaPay React hooks and components.
 *
 * Features:
 * - Automatic purchase status checking
 * - Customer reference caching in localStorage
 * - Payment intent creation and processing
 * - Authentication adapter support (Supabase, custom, etc.)
 * - Zero-config with sensible defaults, or full customization
 *
 * @param props - Provider configuration
 * @param props.config - Configuration object for API routes and authentication
 * @param props.config.api - API route configuration (optional, uses defaults if not provided)
 * @param props.config.api.checkPurchase - Endpoint for checking purchase status (default: '/api/check-purchase')
 * @param props.config.api.createPayment - Endpoint for creating payment intents (default: '/api/create-payment-intent')
 * @param props.config.api.processPayment - Endpoint for processing payments (default: '/api/process-payment')
 * @param props.config.auth - Authentication configuration (optional)
 * @param props.config.auth.adapter - Auth adapter for extracting user ID and token
 * @param props.children - React children components
 *
 * @example
 * ```tsx
 * import { SolvaPayProvider } from '@solvapay/react';
 *
 * // Zero config (uses defaults)
 * function App() {
 *   return (
 *     <SolvaPayProvider>
 *       <YourApp />
 *     </SolvaPayProvider>
 *   );
 * }
 *
 * // Custom API routes
 * function App() {
 *   return (
 *     <SolvaPayProvider
 *       config={{
 *         api: {
 *           checkPurchase: '/custom/api/purchase',
 *           createPayment: '/custom/api/payment'
 *         }
 *       }}
 *     >
 *       <YourApp />
 *     </SolvaPayProvider>
 *   );
 * }
 *
 * // With Supabase auth adapter
 * import { createSupabaseAuthAdapter } from '@solvapay/react-supabase';
 *
 * function App() {
 *   const adapter = createSupabaseAuthAdapter({
 *     supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
 *     supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
 *   });
 *
 *   return (
 *     <SolvaPayProvider
 *       config={{
 *         auth: { adapter }
 *       }}
 *     >
 *       <YourApp />
 *     </SolvaPayProvider>
 *   );
 * }
 * ```
 *
 * @see {@link usePurchase} for accessing purchase data
 * @see {@link useCheckout} for payment checkout flow
 * @see {@link useSolvaPay} for accessing provider methods
 * @since 1.0.0
 */
export const SolvaPayProvider: React.FC<SolvaPayProviderProps> = ({
  config,
  createPayment: customCreatePayment,
  checkPurchase: customCheckPurchase,
  processPayment: customProcessPayment,
  children,
}) => {
  const [purchaseData, setPurchaseData] = useState<CustomerPurchaseData>({
    purchases: [],
  })
  const [loading, setLoading] = useState(false)
  const [internalCustomerRef, setInternalCustomerRef] = useState<string | undefined>(undefined)
  const [userId, setUserId] = useState<string | null>(null)
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  // Track in-flight requests to prevent duplicate calls
  const inFlightRef = useRef<string | null>(null)
  // Track what we've already fetched to prevent unnecessary refetches
  const lastFetchedRef = useRef<string | null>(null)

  // Store functions in refs to avoid dependency issues
  const checkPurchaseRef = useRef<(() => Promise<CustomerPurchaseData>) | null>(null)
  const createPaymentRef = useRef<
    ((params: { planRef: string; productRef?: string }) => Promise<PaymentIntentResult>) | null
  >(null)
  const processPaymentRef = useRef<
    | ((params: {
        paymentIntentId: string
        productRef: string
        planRef?: string
      }) => Promise<ProcessPaymentResult>)
    | null
  >(null)
  const configRef = useRef(config)
  const buildDefaultCheckPurchaseRef = useRef<(() => Promise<CustomerPurchaseData>) | null>(
    null,
  )

  // Update refs when props change
  useEffect(() => {
    configRef.current = config
  }, [config])

  useEffect(() => {
    checkPurchaseRef.current = customCheckPurchase || null
  }, [customCheckPurchase])

  useEffect(() => {
    createPaymentRef.current = customCreatePayment || null
  }, [customCreatePayment])

  useEffect(() => {
    processPaymentRef.current = customProcessPayment || null
  }, [customProcessPayment])

  // Build default checkPurchase implementation - store in ref to keep it stable
  const buildDefaultCheckPurchase = useCallback(async (): Promise<CustomerPurchaseData> => {
    const currentConfig = configRef.current
    const adapter = getAuthAdapter(currentConfig)
    const token = await adapter.getToken()
    const detectedUserId = await adapter.getUserId()
    const route = currentConfig?.api?.checkPurchase || '/api/check-purchase'
    const fetchFn = currentConfig?.fetch || fetch

    // Get cached customerRef from localStorage, validated against current userId
    const cachedRef = getCachedCustomerRef(detectedUserId)

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    }

    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    if (cachedRef) {
      headers['x-solvapay-customer-ref'] = cachedRef
    }

    // Add custom headers
    if (currentConfig?.headers) {
      const customHeaders =
        typeof currentConfig.headers === 'function'
          ? await currentConfig.headers()
          : currentConfig.headers
      Object.assign(headers, customHeaders)
    }

    const res = await fetchFn(route, {
      method: 'GET',
      headers,
    })

    if (!res.ok) {
      const error = new Error(`Failed to check purchase: ${res.statusText}`)
      currentConfig?.onError?.(error, 'checkPurchase')
      throw error
    }

    return res.json()
  }, [])

  // Store in ref so it doesn't need to be in dependency arrays
  useEffect(() => {
    buildDefaultCheckPurchaseRef.current = buildDefaultCheckPurchase
  }, [buildDefaultCheckPurchase])

  // Build default createPayment implementation
  const buildDefaultCreatePayment = useCallback(
    async (params: { planRef: string; productRef?: string }): Promise<PaymentIntentResult> => {
      const currentConfig = configRef.current
      const adapter = getAuthAdapter(currentConfig)
      const token = await adapter.getToken()
      const detectedUserId = await adapter.getUserId()
      const route = currentConfig?.api?.createPayment || '/api/create-payment-intent'
      const fetchFn = currentConfig?.fetch || fetch

      // Get cached customerRef from localStorage, validated against current userId
      const cachedRef = getCachedCustomerRef(detectedUserId)

      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      }

      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }

      if (cachedRef) {
        headers['x-solvapay-customer-ref'] = cachedRef
      }

      // Add custom headers
      if (currentConfig?.headers) {
        const customHeaders =
          typeof currentConfig.headers === 'function'
            ? await currentConfig.headers()
            : currentConfig.headers
        Object.assign(headers, customHeaders)
      }

      // Build request body with planRef and productRef if provided
      const body: { planRef: string; productRef?: string } = { planRef: params.planRef }
      if (params.productRef) {
        body.productRef = params.productRef
      }

      const res = await fetchFn(route, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const error = new Error(`Failed to create payment: ${res.statusText}`)
        currentConfig?.onError?.(error, 'createPayment')
        throw error
      }

      return res.json()
    },
    [],
  )

  // Build default processPayment implementation
  const buildDefaultProcessPayment = useCallback(
    async (params: {
      paymentIntentId: string
      productRef: string
      planRef?: string
    }): Promise<ProcessPaymentResult> => {
      const currentConfig = configRef.current
      const adapter = getAuthAdapter(currentConfig)
      const token = await adapter.getToken()
      const detectedUserId = await adapter.getUserId()
      const route = currentConfig?.api?.processPayment || '/api/process-payment'
      const fetchFn = currentConfig?.fetch || fetch

      // Get cached customerRef from localStorage, validated against current userId
      const cachedRef = getCachedCustomerRef(detectedUserId)

      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      }

      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }

      if (cachedRef) {
        headers['x-solvapay-customer-ref'] = cachedRef
      }

      // Add custom headers
      if (currentConfig?.headers) {
        const customHeaders =
          typeof currentConfig.headers === 'function'
            ? await currentConfig.headers()
            : currentConfig.headers
        Object.assign(headers, customHeaders)
      }

      const res = await fetchFn(route, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
      })

      if (!res.ok) {
        const error = new Error(`Failed to process payment: ${res.statusText}`)
        currentConfig?.onError?.(error, 'processPayment')
        throw error
      }

      return res.json() as Promise<ProcessPaymentResult>
    },
    [],
  )

  // Get the actual functions to use (priority: custom > config > defaults)
  // Use refs to avoid dependency issues - this keeps the function stable
  const _checkPurchase = useCallback(async (): Promise<CustomerPurchaseData> => {
    if (checkPurchaseRef.current) {
      return checkPurchaseRef.current()
    }
    if (buildDefaultCheckPurchaseRef.current) {
      return buildDefaultCheckPurchaseRef.current()
    }
    // Fallback (shouldn't happen, but TypeScript needs it)
    return buildDefaultCheckPurchase()
  }, [buildDefaultCheckPurchase])

  const createPayment = useCallback(
    async (params: { planRef: string; productRef?: string }): Promise<PaymentIntentResult> => {
      if (createPaymentRef.current) {
        return createPaymentRef.current(params)
      }
      return buildDefaultCreatePayment(params)
    },
    [buildDefaultCreatePayment],
  )

  const processPayment = useCallback(
    async (params: {
      paymentIntentId: string
      productRef: string
      planRef?: string
    }): Promise<ProcessPaymentResult> => {
      if (processPaymentRef.current) {
        return processPaymentRef.current(params)
      }
      return buildDefaultProcessPayment(params)
    },
    [buildDefaultProcessPayment],
  )

  // Detect authentication state and user ID
  useEffect(() => {
    const detectAuth = async () => {
      const currentConfig = configRef.current
      const adapter = getAuthAdapter(currentConfig)

      const token = await adapter.getToken()
      const detectedUserId = await adapter.getUserId()

      // Track previous userId to detect user changes
      const prevUserId = userId

      setIsAuthenticated(!!token)
      setUserId(detectedUserId)

      // CRITICAL: Clear customerRef cache if userId changes (user switched accounts)
      // This prevents purchasing for the wrong user
      if (prevUserId !== null && detectedUserId !== prevUserId) {
        clearCachedCustomerRef()
        setInternalCustomerRef(undefined)
        return
      }

      // If we have a cached customerRef and are authenticated, validate it belongs to current user
      const cachedRef = getCachedCustomerRef(detectedUserId)
      if (cachedRef && token) {
        setInternalCustomerRef(cachedRef)
      } else if (!token) {
        // Clear cache on sign-out
        clearCachedCustomerRef()
        setInternalCustomerRef(undefined)
      } else if (token && !cachedRef) {
        // Authenticated but no valid cached customerRef - clear internal ref
        setInternalCustomerRef(undefined)
      }
    }

    detectAuth()

    // Set up polling to detect auth changes (e.g., token refresh)
    const interval = setInterval(detectAuth, 5000) // Check every 5 seconds

    return () => clearInterval(interval)
  }, [userId]) // Include userId in deps to detect changes

  // Fetch purchase function - memoized to prevent unnecessary re-renders
  // Use refs for checkPurchase to avoid dependency issues
  const fetchPurchase = useCallback(
    async (force = false) => {
      // Only fetch if authenticated or if we have a customerRef
      if (!isAuthenticated && !internalCustomerRef) {
        setPurchaseData({ purchases: [] })
        setLoading(false)
        inFlightRef.current = null
        lastFetchedRef.current = null
        return
      }

      const cacheKey = internalCustomerRef || userId || 'anonymous'

      // Skip if we've already fetched this cacheKey (unless it's in-flight or forced)
      if (!force && lastFetchedRef.current === cacheKey && inFlightRef.current !== cacheKey) {
        return
      }

      // Prevent duplicate concurrent requests for the same cacheKey
      if (inFlightRef.current === cacheKey) {
        return
      }

      inFlightRef.current = cacheKey
      setLoading(true)

      try {
        // Use ref to get the current checkPurchase function
        const checkFn = checkPurchaseRef.current || buildDefaultCheckPurchaseRef.current
        if (!checkFn) {
          throw new Error('checkPurchase function not available')
        }
        const data = await checkFn()

        // Store customerRef from response if available
        // Only cache if we have a userId to prevent cross-user contamination
        if (data.customerRef) {
          setInternalCustomerRef(data.customerRef)
          // Get current userId to associate with customerRef
          const currentAdapter = getAuthAdapter(configRef.current)
          const currentUserId = await currentAdapter.getUserId()
          setCachedCustomerRef(data.customerRef, currentUserId)
        }

        // Only update if this is still the current cacheKey (might have changed during fetch)
        if (inFlightRef.current === cacheKey) {
          // Filter purchases using shared utility
          const filteredData: CustomerPurchaseData = {
            ...data,
            purchases: filterPurchases(data.purchases || []),
          }

          setPurchaseData(filteredData)
          lastFetchedRef.current = cacheKey
        }
      } catch (error) {
        console.error('[SolvaPayProvider] Failed to fetch purchase:', error)
        // On error, set empty purchases
        if (inFlightRef.current === cacheKey) {
          setPurchaseData({
            purchases: [],
          })
          lastFetchedRef.current = cacheKey
        }
      } finally {
        if (inFlightRef.current === cacheKey) {
          setLoading(false)
          inFlightRef.current = null
        }
      }
    },
    [isAuthenticated, internalCustomerRef, userId],
  )

  // Refetch purchase function - forces a fresh fetch by clearing cache
  // Use ref to get fetchPurchase to avoid dependency issues
  const fetchPurchaseRef = useRef(fetchPurchase)
  useEffect(() => {
    fetchPurchaseRef.current = fetchPurchase
  }, [fetchPurchase])

  const refetchPurchase = useCallback(async () => {
    // Always clear cache state before refetching to ensure fresh data
    // Clear both the cache key tracking and in-flight requests
    lastFetchedRef.current = null
    inFlightRef.current = null

    // Also clear purchase data temporarily to ensure UI reflects loading state
    // This prevents showing stale data while fetching
    setPurchaseData({ purchases: [] })

    // Force a fresh fetch by passing force=true
    // This bypasses the cache check and ensures we get the latest data from the server
    await fetchPurchaseRef.current(true)
  }, [])

  // Auto-fetch purchases on mount and when auth state changes
  // Only depend on actual values, not the function itself
  useEffect(() => {
    // Clear cache when userId or customerRef changes to prevent stale data
    // This is important when switching accounts or when customerRef is updated
    lastFetchedRef.current = null
    inFlightRef.current = null

    if (isAuthenticated || internalCustomerRef) {
      fetchPurchase()
    } else {
      setPurchaseData({ purchases: [] })
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, internalCustomerRef, userId])

  // Update customer ref method
  const updateCustomerRef = useCallback(
    (newCustomerRef: string) => {
      setInternalCustomerRef(newCustomerRef)
      // Store with current userId to prevent cross-user contamination
      setCachedCustomerRef(newCustomerRef, userId)
      // Trigger refetch
      fetchPurchase(true)
    },
    [fetchPurchase, userId],
  )

  // Build purchase status with helper methods - memoized to prevent unnecessary re-renders
  const purchase: PurchaseStatus = useMemo(() => {
    // Get primary active purchase (paid or free) - most recent active purchase
    const activePurchase = getPrimaryPurchase(purchaseData.purchases)

    // Compute active paid purchases
    // Backend keeps purchases as 'active' until expiration, even when cancelled
    const activePaidPurchases = purchaseData.purchases.filter(
      p => p.status === 'active' && isPaidPurchase(p),
    )

    // Get most recent active paid purchase (sorted by startDate)
    const activePaidPurchase =
      activePaidPurchases.sort(
        (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime(),
      )[0] || null

    return {
      loading,
      customerRef: purchaseData.customerRef || internalCustomerRef,
      email: purchaseData.email,
      name: purchaseData.name,
      purchases: purchaseData.purchases,
      hasPlan: (planName: string) => {
        return purchaseData.purchases.some(
          p => p.planName.toLowerCase() === planName.toLowerCase() && p.status === 'active',
        )
      },
      activePurchase,
      hasPaidPurchase: activePaidPurchases.length > 0,
      activePaidPurchase,
    }
  }, [loading, purchaseData, internalCustomerRef])

  // Memoize context value to prevent unnecessary re-renders of consumers
  const contextValue: SolvaPayContextValue = useMemo(
    () => ({
      purchase,
      refetchPurchase,
      createPayment,
      processPayment,
      customerRef: purchaseData.customerRef || internalCustomerRef,
      updateCustomerRef,
    }),
    [
      purchase,
      refetchPurchase,
      createPayment,
      processPayment,
      purchaseData.customerRef,
      internalCustomerRef,
      updateCustomerRef,
    ],
  )

  return <SolvaPayContext.Provider value={contextValue}>{children}</SolvaPayContext.Provider>
}
