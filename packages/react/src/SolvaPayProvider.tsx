'use client'
import React, { createContext, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type {
  SolvaPayProviderProps,
  SolvaPayContextValue,
  PurchaseStatus,
  CustomerPurchaseData,
  PaymentIntentResult,
  TopupPaymentResult,
  CreditBalance,
  BalanceStatus,
} from './types'
import type { ProcessPaymentResult } from '@solvapay/server'
import {
  filterPurchases,
  isPaidPurchase,
  getPrimaryPurchase,
} from './utils/purchases'
import {
  getAuthAdapter,
  getCachedCustomerRef,
  setCachedCustomerRef,
  clearCachedCustomerRef,
  buildRequestHeaders,
} from './utils/headers'

export const SolvaPayContext = createContext<SolvaPayContextValue | null>(null)

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
  createTopupPayment: customCreateTopupPayment,
  children,
}) => {
  const [purchaseData, setPurchaseData] = useState<CustomerPurchaseData>({
    purchases: [],
  })
  const [loading, setLoading] = useState(false)
  const [internalCustomerRef, setInternalCustomerRef] = useState<string | undefined>(undefined)
  const [userId, setUserId] = useState<string | null>(null)
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  const [balances, setBalances] = useState<CreditBalance[]>([])
  const [balanceLoading, setBalanceLoading] = useState(false)
  const balanceInFlightRef = useRef(false)
  const balanceLoadedRef = useRef(false)

  const optimisticUntilRef = useRef(0)
  const optimisticTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fetchBalanceRef = useRef<(() => Promise<void>) | null>(null)

  // Track in-flight requests to prevent duplicate calls
  const inFlightRef = useRef<string | null>(null)
  // Track what we've already fetched to prevent unnecessary refetches
  const lastFetchedRef = useRef<string | null>(null)

  // Store functions in refs to avoid dependency issues
  const checkPurchaseRef = useRef<(() => Promise<CustomerPurchaseData>) | null>(null)
  const createPaymentRef = useRef<
    ((params: { planRef?: string; productRef?: string }) => Promise<PaymentIntentResult>) | null
  >(null)
  const processPaymentRef = useRef<
    | ((params: {
        paymentIntentId: string
        productRef: string
        planRef?: string
      }) => Promise<ProcessPaymentResult>)
    | null
  >(null)
  const createTopupPaymentRef = useRef<
    ((params: { amount: number; currency?: string }) => Promise<TopupPaymentResult>) | null
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

  useEffect(() => {
    createTopupPaymentRef.current = customCreateTopupPayment || null
  }, [customCreateTopupPayment])

  const buildDefaultCheckPurchase = useCallback(async (): Promise<CustomerPurchaseData> => {
    const currentConfig = configRef.current
    const { headers } = await buildRequestHeaders(currentConfig)
    const route = currentConfig?.api?.checkPurchase || '/api/check-purchase'
    const fetchFn = currentConfig?.fetch || fetch

    const res = await fetchFn(route, { method: 'GET', headers })

    if (!res.ok) {
      const error = new Error(`Failed to check purchase: ${res.statusText}`)
      currentConfig?.onError?.(error, 'checkPurchase')
      throw error
    }

    return res.json()
  }, [])

  useEffect(() => {
    buildDefaultCheckPurchaseRef.current = buildDefaultCheckPurchase
  }, [buildDefaultCheckPurchase])

  const buildDefaultCreatePayment = useCallback(
    async (params: { planRef?: string; productRef?: string }): Promise<PaymentIntentResult> => {
      const currentConfig = configRef.current
      const { headers } = await buildRequestHeaders(currentConfig)
      const route = currentConfig?.api?.createPayment || '/api/create-payment-intent'
      const fetchFn = currentConfig?.fetch || fetch

      const body: { planRef?: string; productRef?: string } = {}
      if (params.planRef) {
        body.planRef = params.planRef
      }
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

  const buildDefaultProcessPayment = useCallback(
    async (params: {
      paymentIntentId: string
      productRef: string
      planRef?: string
    }): Promise<ProcessPaymentResult> => {
      const currentConfig = configRef.current
      const { headers } = await buildRequestHeaders(currentConfig)
      const route = currentConfig?.api?.processPayment || '/api/process-payment'
      const fetchFn = currentConfig?.fetch || fetch

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

  const buildDefaultCreateTopupPayment = useCallback(
    async (params: { amount: number; currency?: string }): Promise<TopupPaymentResult> => {
      const currentConfig = configRef.current
      const { headers } = await buildRequestHeaders(currentConfig)
      const route = currentConfig?.api?.createTopupPayment || '/api/create-topup-payment-intent'
      const fetchFn = currentConfig?.fetch || fetch

      const res = await fetchFn(route, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          amount: params.amount,
          currency: params.currency,
        }),
      })

      if (!res.ok) {
        const error = new Error(`Failed to create topup payment: ${res.statusText}`)
        currentConfig?.onError?.(error, 'createTopupPayment')
        throw error
      }

      return res.json()
    },
    [],
  )

  // Balance is fetched on-demand via useBalance(), not eagerly on mount.
  const fetchBalanceImpl = useCallback(async () => {
    if (optimisticUntilRef.current > Date.now()) return

    if (!isAuthenticated && !internalCustomerRef) {
      setBalances([])
      setBalanceLoading(false)
      balanceLoadedRef.current = false
      return
    }

    if (balanceInFlightRef.current) return
    balanceInFlightRef.current = true
    if (!balanceLoadedRef.current) {
      setBalanceLoading(true)
    }

    try {
      const currentConfig = configRef.current
      const { headers } = await buildRequestHeaders(currentConfig)
      const route = currentConfig?.api?.customerBalance || '/api/customer-balance'
      const fetchFn = currentConfig?.fetch || fetch

      const res = await fetchFn(route, { method: 'GET', headers })

      if (!res.ok) {
        console.error('[SolvaPayProvider] Failed to fetch balance:', res.statusText)
        return
      }

      const data = await res.json()
      setBalances(data.balances || [])
      balanceLoadedRef.current = true
    } catch (error) {
      console.error('[SolvaPayProvider] Failed to fetch balance:', error)
    } finally {
      setBalanceLoading(false)
      balanceInFlightRef.current = false
    }
  }, [isAuthenticated, internalCustomerRef])

  useEffect(() => {
    fetchBalanceRef.current = fetchBalanceImpl
  }, [fetchBalanceImpl])

  useEffect(() => {
    return () => {
      if (optimisticTimerRef.current) clearTimeout(optimisticTimerRef.current)
    }
  }, [])

  const OPTIMISTIC_GRACE_MS = 8000

  const adjustBalanceImpl = useCallback((amount: number, currency = 'USD') => {
    setBalances(prev => {
      const upper = currency.toUpperCase()
      const idx = prev.findIndex(b => b.currency.toUpperCase() === upper)
      if (idx >= 0) {
        const updated = [...prev]
        updated[idx] = { ...updated[idx], balance: updated[idx].balance + amount }
        return updated
      }
      return [...prev, { currency: upper, balance: amount }]
    })

    optimisticUntilRef.current = Date.now() + OPTIMISTIC_GRACE_MS

    if (optimisticTimerRef.current) clearTimeout(optimisticTimerRef.current)
    optimisticTimerRef.current = setTimeout(() => {
      optimisticUntilRef.current = 0
      fetchBalanceRef.current?.()
    }, OPTIMISTIC_GRACE_MS)
  }, [])

  // Get the actual functions to use (priority: custom > config > defaults)
  // Use refs to avoid dependency issues - this keeps the function stable
  const _checkPurchase = useCallback(async (): Promise<CustomerPurchaseData> => {
    if (checkPurchaseRef.current) {
      return checkPurchaseRef.current()
    }
    if (buildDefaultCheckPurchaseRef.current) {
      return buildDefaultCheckPurchaseRef.current()
    }
    return buildDefaultCheckPurchase()
  }, [buildDefaultCheckPurchase])

  const createPayment = useCallback(
    async (params: { planRef?: string; productRef?: string }): Promise<PaymentIntentResult> => {
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

  const createTopupPayment = useCallback(
    async (params: { amount: number; currency?: string }): Promise<TopupPaymentResult> => {
      if (createTopupPaymentRef.current) {
        return createTopupPaymentRef.current(params)
      }
      return buildDefaultCreateTopupPayment(params)
    },
    [buildDefaultCreateTopupPayment],
  )

  // Detect authentication state and user ID
  useEffect(() => {
    const detectAuth = async () => {
      const currentConfig = configRef.current
      const adapter = getAuthAdapter(currentConfig)

      const token = await adapter.getToken()
      const detectedUserId = await adapter.getUserId()

      const prevUserId = userId

      setIsAuthenticated(!!token)
      setUserId(detectedUserId)

      if (prevUserId !== null && detectedUserId !== prevUserId) {
        clearCachedCustomerRef()
        setInternalCustomerRef(undefined)
        return
      }

      const cachedRef = getCachedCustomerRef(detectedUserId)
      if (cachedRef && token) {
        setInternalCustomerRef(cachedRef)
      } else if (!token) {
        clearCachedCustomerRef()
        setInternalCustomerRef(undefined)
      } else if (token && !cachedRef) {
        setInternalCustomerRef(undefined)
      }
    }

    detectAuth()

    const interval = setInterval(detectAuth, 5000)

    return () => clearInterval(interval)
  }, [userId])

  // Fetch purchase function - memoized to prevent unnecessary re-renders
  const fetchPurchase = useCallback(
    async (force = false) => {
      if (!isAuthenticated && !internalCustomerRef) {
        setPurchaseData({ purchases: [] })
        setLoading(false)
        inFlightRef.current = null
        lastFetchedRef.current = null
        return
      }

      const cacheKey = internalCustomerRef || userId || 'anonymous'

      if (!force && lastFetchedRef.current === cacheKey && inFlightRef.current !== cacheKey) {
        return
      }

      if (inFlightRef.current === cacheKey) {
        return
      }

      inFlightRef.current = cacheKey
      setLoading(true)

      try {
        const checkFn = checkPurchaseRef.current || buildDefaultCheckPurchaseRef.current
        if (!checkFn) {
          throw new Error('checkPurchase function not available')
        }
        const data = await checkFn()

        if (data.customerRef) {
          setInternalCustomerRef(data.customerRef)
          const currentAdapter = getAuthAdapter(configRef.current)
          const currentUserId = await currentAdapter.getUserId()
          setCachedCustomerRef(data.customerRef, currentUserId)
        }

        if (inFlightRef.current === cacheKey) {
          const filteredData: CustomerPurchaseData = {
            ...data,
            purchases: filterPurchases(data.purchases || []),
          }

          setPurchaseData(filteredData)
          lastFetchedRef.current = cacheKey
        }
      } catch (error) {
        console.error('[SolvaPayProvider] Failed to fetch purchase:', error)
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

  const fetchPurchaseRef = useRef(fetchPurchase)
  useEffect(() => {
    fetchPurchaseRef.current = fetchPurchase
  }, [fetchPurchase])

  const refetchPurchase = useCallback(async () => {
    lastFetchedRef.current = null
    inFlightRef.current = null
    setPurchaseData({ purchases: [] })
    await fetchPurchaseRef.current(true)
  }, [])

  // Auto-fetch purchases on mount and when auth state changes
  useEffect(() => {
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

  const updateCustomerRef = useCallback(
    (newCustomerRef: string) => {
      setInternalCustomerRef(newCustomerRef)
      setCachedCustomerRef(newCustomerRef, userId)
      fetchPurchase(true)
    },
    [fetchPurchase, userId],
  )

  const purchase: PurchaseStatus = useMemo(() => {
    const activePurchase = getPrimaryPurchase(purchaseData.purchases)

    const activePaidPurchases = purchaseData.purchases.filter(
      p => p.status === 'active' && isPaidPurchase(p),
    )

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
      hasProduct: (productName: string) => {
        return purchaseData.purchases.some(
          p => p.productName.toLowerCase() === productName.toLowerCase() && p.status === 'active',
        )
      },
      hasPlan: (productName: string) => {
        return purchaseData.purchases.some(
          p => p.productName.toLowerCase() === productName.toLowerCase() && p.status === 'active',
        )
      },
      activePurchase,
      hasPaidPurchase: activePaidPurchases.length > 0,
      activePaidPurchase,
    }
  }, [loading, purchaseData, internalCustomerRef])

  const balance: BalanceStatus = useMemo(
    () => ({
      loading: balanceLoading,
      balances,
      refetch: fetchBalanceImpl,
      adjustBalance: adjustBalanceImpl,
    }),
    [balanceLoading, balances, fetchBalanceImpl, adjustBalanceImpl],
  )

  const contextValue: SolvaPayContextValue = useMemo(
    () => ({
      purchase,
      refetchPurchase,
      createPayment,
      processPayment,
      createTopupPayment,
      customerRef: purchaseData.customerRef || internalCustomerRef,
      updateCustomerRef,
      balance,
    }),
    [
      purchase,
      refetchPurchase,
      createPayment,
      processPayment,
      createTopupPayment,
      purchaseData.customerRef,
      internalCustomerRef,
      updateCustomerRef,
      balance,
    ],
  )

  return <SolvaPayContext.Provider value={contextValue}>{children}</SolvaPayContext.Provider>
}
