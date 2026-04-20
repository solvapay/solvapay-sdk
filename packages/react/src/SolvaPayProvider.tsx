'use client'
import React, { createContext, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type {
  SolvaPayProviderProps,
  SolvaPayContextValue,
  PurchaseStatus,
  CustomerPurchaseData,
  PaymentIntentResult,
  TopupPaymentResult,
  BalanceStatus,
  CancelResult,
  ReactivateResult,
  PrefillCustomer,
  SolvaPayConfig,
} from './types'
import type { ProcessPaymentResult, ActivatePlanResult } from '@solvapay/server'
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
} from './utils/headers'
import { createHttpTransport } from './transport/http'
import type { SolvaPayTransport } from './transport/types'
import { CopyProvider } from './i18n/context'

export const SolvaPayContext = createContext<SolvaPayContextValue | null>(null)

function resolveTransport(config: SolvaPayConfig | undefined): SolvaPayTransport {
  return config?.transport ?? createHttpTransport(config)
}

/**
 * SolvaPay Provider - Headless Context Provider for React.
 *
 * Provides purchase state, payment methods, and customer data to child components
 * via React Context. This is the root component that must wrap your app to use
 * SolvaPay React hooks and components.
 *
 * All data access flows through `config.transport`. When omitted, a default
 * HTTP transport is built from `config.api` + `config.fetch`. Integrators who
 * need to route calls somewhere else (e.g. MCP hosts) pass a custom transport
 * — see `@solvapay/react/mcp` and `createHttpTransport` for building blocks.
 *
 * @example
 * ```tsx
 * import { SolvaPayProvider } from '@solvapay/react'
 *
 * function App() {
 *   return (
 *     <SolvaPayProvider>
 *       <YourApp />
 *     </SolvaPayProvider>
 *   )
 * }
 * ```
 *
 * @example MCP App
 * ```tsx
 * import { SolvaPayProvider } from '@solvapay/react'
 * import { createMcpAppAdapter } from '@solvapay/react/mcp'
 *
 * const transport = createMcpAppAdapter(app)
 *
 * function App() {
 *   return (
 *     <SolvaPayProvider config={{ transport }}>
 *       <YourApp />
 *     </SolvaPayProvider>
 *   )
 * }
 * ```
 */
export const SolvaPayProvider: React.FC<SolvaPayProviderProps> = ({ config, children }) => {
  const [purchaseData, setPurchaseData] = useState<CustomerPurchaseData>({
    purchases: [],
  })
  const [loading, setLoading] = useState(false)
  const [isRefetching, setIsRefetching] = useState(false)
  const [purchaseError, setPurchaseError] = useState<Error | null>(null)
  const [internalCustomerRef, setInternalCustomerRef] = useState<string | undefined>(undefined)
  const [userId, setUserId] = useState<string | null>(null)
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  const [creditsValue, setCreditsValue] = useState<number | null>(null)
  const [displayCurrencyValue, setDisplayCurrencyValue] = useState<string | null>(null)
  const [creditsPerMinorUnitValue, setCreditsPerMinorUnitValue] = useState<number | null>(null)
  const [displayExchangeRateValue, setDisplayExchangeRateValue] = useState<number | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(false)
  const balanceInFlightRef = useRef(false)
  const balanceLoadedRef = useRef(false)

  const optimisticUntilRef = useRef(0)
  const optimisticTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fetchBalanceRef = useRef<(() => Promise<void>) | null>(null)

  const inFlightRef = useRef<string | null>(null)
  const loadedCacheKeysRef = useRef<Set<string>>(new Set())

  const configRef = useRef(config)
  const transportRef = useRef<SolvaPayTransport>(resolveTransport(config))

  useEffect(() => {
    configRef.current = config
    transportRef.current = resolveTransport(config)
  }, [config])

  const fetchBalanceImpl = useCallback(async () => {
    if (optimisticUntilRef.current > Date.now()) return

    if (!isAuthenticated && !internalCustomerRef) {
      setCreditsValue(null)
      setDisplayCurrencyValue(null)
      setCreditsPerMinorUnitValue(null)
      setDisplayExchangeRateValue(null)
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
      const data = await transportRef.current.getBalance()
      setCreditsValue(data.credits ?? null)
      setDisplayCurrencyValue(data.displayCurrency ?? null)
      setCreditsPerMinorUnitValue(data.creditsPerMinorUnit ?? null)
      setDisplayExchangeRateValue(data.displayExchangeRate ?? null)
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

  const adjustBalanceImpl = useCallback((credits: number) => {
    setCreditsValue(prev => (prev ?? 0) + credits)

    optimisticUntilRef.current = Date.now() + OPTIMISTIC_GRACE_MS

    if (optimisticTimerRef.current) clearTimeout(optimisticTimerRef.current)
    optimisticTimerRef.current = setTimeout(() => {
      optimisticUntilRef.current = 0
      fetchBalanceRef.current?.()
    }, OPTIMISTIC_GRACE_MS)
  }, [])

  const createPayment = useCallback(
    (params: {
      planRef?: string
      productRef?: string
      customer?: PrefillCustomer
    }): Promise<PaymentIntentResult> => transportRef.current.createPayment(params),
    [],
  )

  const processPayment = useCallback(
    (params: {
      paymentIntentId: string
      productRef: string
      planRef?: string
    }): Promise<ProcessPaymentResult> => transportRef.current.processPayment(params),
    [],
  )

  const createTopupPayment = useCallback(
    (params: { amount: number; currency?: string }): Promise<TopupPaymentResult> =>
      transportRef.current.createTopupPayment(params),
    [],
  )

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
        loadedCacheKeysRef.current.clear()
        return
      }

      const cachedRef = getCachedCustomerRef(detectedUserId)
      if (cachedRef && token) {
        setInternalCustomerRef(cachedRef)
      } else if (!token) {
        clearCachedCustomerRef()
        setInternalCustomerRef(undefined)
        loadedCacheKeysRef.current.clear()
      } else if (token && !cachedRef) {
        setInternalCustomerRef(undefined)
      }
    }

    detectAuth()

    const adapter = getAuthAdapter(configRef.current)
    if (typeof adapter.subscribe === 'function') {
      const unsubscribe = adapter.subscribe(() => {
        detectAuth()
      })
      return unsubscribe
    }

    const interval = setInterval(detectAuth, 30000)
    return () => clearInterval(interval)
  }, [userId])

  const fetchPurchase = useCallback(
    async (force = false) => {
      if (!isAuthenticated && !internalCustomerRef) {
        setPurchaseData({ purchases: [] })
        setPurchaseError(null)
        setLoading(false)
        setIsRefetching(false)
        inFlightRef.current = null
        return
      }

      const cacheKey = internalCustomerRef || userId || 'anonymous'

      if (inFlightRef.current === cacheKey && !force) {
        return
      }

      inFlightRef.current = cacheKey

      const hasLoadedOnce = loadedCacheKeysRef.current.has(cacheKey)
      if (hasLoadedOnce) {
        setIsRefetching(true)
      } else {
        setLoading(true)
      }

      try {
        const data = await transportRef.current.checkPurchase()

        if (data.customerRef) {
          setInternalCustomerRef(data.customerRef)
          // Mark the resolved cacheKey as loaded too. The provider re-runs
          // `fetchPurchase` when `internalCustomerRef` changes, and without
          // this the follow-up fetch would treat the new cacheKey as a fresh
          // first-load (flipping `loading: true` a second time).
          loadedCacheKeysRef.current.add(data.customerRef)
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
          setPurchaseError(null)
        }
      } catch (err) {
        console.error('[SolvaPayProvider] Failed to fetch purchase:', err)
        if (inFlightRef.current === cacheKey) {
          setPurchaseError(err instanceof Error ? err : new Error(String(err)))
        }
      } finally {
        if (inFlightRef.current === cacheKey) {
          loadedCacheKeysRef.current.add(cacheKey)
          setLoading(false)
          setIsRefetching(false)
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
    inFlightRef.current = null
    await fetchPurchaseRef.current(true)
  }, [])

  const cancelRenewal = useCallback(
    async (params: { purchaseRef: string; reason?: string }): Promise<CancelResult> => {
      const result = await transportRef.current.cancelRenewal(params)
      await refetchPurchase()
      return result
    },
    [refetchPurchase],
  )

  const reactivateRenewal = useCallback(
    async (params: { purchaseRef: string }): Promise<ReactivateResult> => {
      const result = await transportRef.current.reactivateRenewal(params)
      await refetchPurchase()
      return result
    },
    [refetchPurchase],
  )

  const activatePlan = useCallback(
    async (params: { productRef: string; planRef: string }): Promise<ActivatePlanResult> => {
      const result = await transportRef.current.activatePlan(params)
      if (result.status === 'activated' || result.status === 'already_active') {
        await refetchPurchase()
      }
      return result
    },
    [refetchPurchase],
  )

  useEffect(() => {
    inFlightRef.current = null

    if (isAuthenticated || internalCustomerRef) {
      fetchPurchase()
    } else {
      setPurchaseData({ purchases: [] })
      setPurchaseError(null)
      setLoading(false)
      setIsRefetching(false)
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
      isRefetching,
      error: purchaseError,
      customerRef: purchaseData.customerRef || internalCustomerRef,
      email: purchaseData.email,
      name: purchaseData.name,
      purchases: purchaseData.purchases,
      hasProduct: (productName: string) => {
        return purchaseData.purchases.some(
          p => p.productName.toLowerCase() === productName.toLowerCase() && p.status === 'active',
        )
      },
      activePurchase,
      hasPaidPurchase: activePaidPurchases.length > 0,
      activePaidPurchase,
    }
  }, [loading, isRefetching, purchaseError, purchaseData, internalCustomerRef])

  const balance: BalanceStatus = useMemo(
    () => ({
      loading: balanceLoading,
      credits: creditsValue,
      displayCurrency: displayCurrencyValue,
      creditsPerMinorUnit: creditsPerMinorUnitValue,
      displayExchangeRate: displayExchangeRateValue,
      refetch: fetchBalanceImpl,
      adjustBalance: adjustBalanceImpl,
    }),
    [
      balanceLoading,
      creditsValue,
      displayCurrencyValue,
      creditsPerMinorUnitValue,
      displayExchangeRateValue,
      fetchBalanceImpl,
      adjustBalanceImpl,
    ],
  )

  const contextValue: SolvaPayContextValue = useMemo(
    () => ({
      purchase,
      refetchPurchase,
      createPayment,
      processPayment,
      createTopupPayment,
      cancelRenewal,
      reactivateRenewal,
      activatePlan,
      customerRef: purchaseData.customerRef || internalCustomerRef,
      updateCustomerRef,
      balance,
      _config: configRef.current,
    }),
    [
      purchase,
      refetchPurchase,
      createPayment,
      processPayment,
      createTopupPayment,
      cancelRenewal,
      reactivateRenewal,
      activatePlan,
      purchaseData.customerRef,
      internalCustomerRef,
      updateCustomerRef,
      balance,
    ],
  )

  return (
    <SolvaPayContext.Provider value={contextValue}>
      <CopyProvider locale={config?.locale} copy={config?.copy}>
        {children}
      </CopyProvider>
    </SolvaPayContext.Provider>
  )
}
