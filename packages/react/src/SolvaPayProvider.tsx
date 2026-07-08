'use client'
import React, { createContext, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type {
  SolvaPayProviderProps,
  SolvaPayContextValue,
  PurchaseStatus,
  CustomerPurchaseData,
  PaymentIntentResult,
  PurchaseInfo,
  TopupPaymentResult,
  BalanceStatus,
  CancelResult,
  ReactivateResult,
  PrefillCustomer,
  SolvaPayConfig,
  SolvaPayProviderInitial,
} from './types'
import type {
  ProcessPaymentResult,
  TopupProcessResult,
  ActivatePlanResult,
} from '@solvapay/server'
import { pollBalanceUntilIncreased, BALANCE_RECONCILE_DELAYS_MS } from '@solvapay/server'
import {
  BALANCE_RECONCILE_GRACE_MS,
} from './helpers/auto-recharge-cache'
import {
  filterPurchases,
  isPaidPurchase,
  isPlanPurchase,
  getPrimaryPurchase,
} from './utils/purchases'
import {
  getAuthAdapter,
  getCachedCustomerRef,
  setCachedCustomerRef,
  clearCachedCustomerRef,
} from './utils/headers'
import { createHttpTransport } from './transport/http'
import type { CreditDisplayBlock, SolvaPayTransport } from './transport/types'
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
  const initial = config?.initial
  const [purchaseData, setPurchaseData] = useState<CustomerPurchaseData>(() => {
    if (!initial) return { purchases: [] }
    return {
      // The server-side `PurchaseCheckResult.purchases` shape has looser
      // optional fields than `PurchaseInfo`, but the runtime data is
      // identical — the same rows flow through `transport.checkPurchase()`
      // today. Cast once here to unify the two entry points, and run
      // the same `filterPurchases` the HTTP path applies in
      // `fetchPurchase` so the bootstrap-hydrated data never contains
      // cancelled / expired / suspended rows the active-only derivations
      // (`activePurchase`, `hasPaidPurchase`, …) wouldn't expect.
      purchases: filterPurchases(
        (initial.purchase?.purchases ?? []) as unknown as CustomerPurchaseData['purchases'],
      ),
      customerRef: initial.customerRef ?? initial.purchase?.customerRef,
      email: initial.purchase?.email,
      name: initial.purchase?.name,
    }
  })
  const [loading, setLoading] = useState(false)
  const [isRefetching, setIsRefetching] = useState(false)
  const [purchaseError, setPurchaseError] = useState<Error | null>(null)
  const [internalCustomerRef, setInternalCustomerRef] = useState<string | undefined>(
    initial?.customerRef ?? undefined,
  )
  const [userId, setUserId] = useState<string | null>(null)
  const [isAuthenticated, setIsAuthenticated] = useState(!!initial?.customerRef)

  const [creditsValue, setCreditsValue] = useState<number | null>(
    initial?.balance?.credits ?? null,
  )
  const [displayCurrencyValue, setDisplayCurrencyValue] = useState<string | null>(
    initial?.balance?.displayCurrency ?? null,
  )
  const [creditsPerMinorUnitValue, setCreditsPerMinorUnitValue] = useState<number | null>(
    initial?.balance?.creditsPerMinorUnit ?? null,
  )
  const [displayExchangeRateValue, setDisplayExchangeRateValue] = useState<number | null>(
    initial?.balance?.displayExchangeRate ?? null,
  )
  const [displayBlockValue, setDisplayBlockValue] = useState<CreditDisplayBlock | null>(
    initial?.balance?.display ?? null,
  )
  const [balanceLoading, setBalanceLoading] = useState(false)
  const balanceInFlightRef = useRef(false)
  const balanceLoadedRef = useRef(!!initial?.balance)
  const creditsValueRef = useRef<number | null>(initial?.balance?.credits ?? null)

  const optimisticUntilRef = useRef(0)
  const optimisticTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fetchBalanceRef = useRef<(() => Promise<void>) | null>(null)
  const reconcileRunningRef = useRef(false)
  const reconcilePollRef = useRef<{ baseline: number; generation: number; pending: number } | null>(null)

  const inFlightRef = useRef<string | null>(null)
  const loadedCacheKeysRef = useRef<Set<string>>(
    new Set(initial?.customerRef ? [initial.customerRef] : []),
  )

  const configRef = useRef(config)
  const transportRef = useRef<SolvaPayTransport>(resolveTransport(config))
  const [hasProcessTopupPayment, setHasProcessTopupPayment] = useState<boolean>(
    () => !!transportRef.current.processTopupPayment,
  )

  useEffect(() => {
    configRef.current = config
    transportRef.current = resolveTransport(config)
    setHasProcessTopupPayment(!!transportRef.current.processTopupPayment)
    setHasAttachBusinessDetails(!!transportRef.current.attachBusinessDetails)
  }, [config])

  const fetchBalanceImpl = useCallback(async () => {
    if (optimisticUntilRef.current > Date.now()) return

    if (!isAuthenticated && !internalCustomerRef) {
      creditsValueRef.current = null
      setCreditsValue(null)
      setDisplayCurrencyValue(null)
      setCreditsPerMinorUnitValue(null)
      setDisplayExchangeRateValue(null)
      setDisplayBlockValue(null)
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
      if (!transportRef.current.getBalance) {
        // MCP transport: balance lives on the bootstrap snapshot and
        // refreshes via `refreshBootstrap()`. Nothing to fetch here.
        setBalanceLoading(false)
        balanceInFlightRef.current = false
        return
      }
      const data = await transportRef.current.getBalance()
      creditsValueRef.current = data.credits ?? null
      setCreditsValue(data.credits ?? null)
      setDisplayCurrencyValue(data.displayCurrency ?? null)
      setCreditsPerMinorUnitValue(data.creditsPerMinorUnit ?? null)
      setDisplayExchangeRateValue(data.displayExchangeRate ?? null)
      setDisplayBlockValue(data.display ?? null)
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
      reconcilePollRef.current = null
      reconcileRunningRef.current = false
    }
  }, [])

  const OPTIMISTIC_GRACE_MS = 8000
  const DEBIT_GRACE_MS = 2000

  const clearOptimisticGrace = useCallback(() => {
    optimisticUntilRef.current = 0
    if (optimisticTimerRef.current) {
      clearTimeout(optimisticTimerRef.current)
      optimisticTimerRef.current = null
    }
  }, [])

  const applyBalanceSnapshot = useCallback(
    (data: {
      credits?: number | null
      displayCurrency?: string | null
      creditsPerMinorUnit?: number | null
      displayExchangeRate?: number | null
      display?: CreditDisplayBlock | null
    }) => {
      creditsValueRef.current = data.credits ?? null
      setCreditsValue(data.credits ?? null)
      setDisplayCurrencyValue(data.displayCurrency ?? null)
      setCreditsPerMinorUnitValue(data.creditsPerMinorUnit ?? null)
      setDisplayExchangeRateValue(data.displayExchangeRate ?? null)
      setDisplayBlockValue(data.display ?? null)
      balanceLoadedRef.current = true
    },
    [],
  )

  const reconcileBalanceIncreaseImpl = useCallback(async () => {
    if (!transportRef.current.getBalance) return

    const finishReconcilePoll = () => {
      reconcilePollRef.current = null
      clearOptimisticGrace()
    }

    reconcileRunningRef.current = true
    try {
      while (reconcilePollRef.current) {
        const { baseline: activeBaseline, generation: activeGeneration } = reconcilePollRef.current

        const pollResult = await pollBalanceUntilIncreased(
          async () => {
            const data = await transportRef.current.getBalance!()
            return { credits: data.credits ?? 0 }
          },
          activeBaseline,
          BALANCE_RECONCILE_DELAYS_MS,
        )

        const pollState = reconcilePollRef.current
        if (!pollState || pollState.generation !== activeGeneration) {
          continue
        }

        if (!pollResult) {
          finishReconcilePoll()
          break
        }

        try {
          const data = await transportRef.current.getBalance!()
          applyBalanceSnapshot(data)
          pollState.pending -= 1
          if (pollState.pending > 0) {
            pollState.baseline = data.credits ?? 0
            continue
          }
        } catch (error) {
          console.error('[SolvaPayProvider] Failed to reconcile balance after auto-recharge:', error)
        }

        finishReconcilePoll()
        break
      }
    } finally {
      reconcileRunningRef.current = false
    }
  }, [applyBalanceSnapshot, clearOptimisticGrace])

  const scheduleGraceRefetch = useCallback((graceMs: number) => {
    optimisticUntilRef.current = Date.now() + graceMs
    if (optimisticTimerRef.current) clearTimeout(optimisticTimerRef.current)
    optimisticTimerRef.current = setTimeout(() => {
      optimisticUntilRef.current = 0
      fetchBalanceRef.current?.()
    }, graceMs)
  }, [])

  const adjustBalanceImpl = useCallback(
    (credits: number) => {
      const nextCredits = (creditsValueRef.current ?? 0) + credits
      creditsValueRef.current = nextCredits
      setCreditsValue(nextCredits)
      if (credits >= 0) {
        scheduleGraceRefetch(OPTIMISTIC_GRACE_MS)
      } else {
        scheduleGraceRefetch(DEBIT_GRACE_MS)
      }
    },
    [scheduleGraceRefetch],
  )

  const reconcileAfterUsageDebitImpl = useCallback(
    (opts?: { expectIncrease?: boolean }) => {
      if (opts?.expectIncrease !== true) {
        return
      }

      const nextCredits = creditsValueRef.current ?? 0
      const generation = (reconcilePollRef.current?.generation ?? 0) + 1
      const pending = (reconcilePollRef.current?.pending ?? 0) + 1
      reconcilePollRef.current = { baseline: nextCredits, generation, pending }
      scheduleGraceRefetch(BALANCE_RECONCILE_GRACE_MS)
      if (!reconcileRunningRef.current) {
        void reconcileBalanceIncreaseImpl()
      }
    },
    [reconcileBalanceIncreaseImpl, scheduleGraceRefetch],
  )

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
    (params: {
      amount: number
      currency?: string
      autoRecharge?: import('@solvapay/server').AutoRechargeInput
    }): Promise<TopupPaymentResult> =>
      transportRef.current.createTopupPayment(params),
    [],
  )

  // Pure transport bridge — no state, no timers, no refs. Exists so
  // `TopupForm.Inner.submit` can wait for backend confirmation
  // (`status: 'succeeded'` plus the webhook handler's credit booking,
  // which lands in the same invocation) before declaring success and
  // closing the drawer.
  const processTopupPayment = useCallback(
    (params: { paymentIntentId: string }): Promise<TopupProcessResult> =>
      transportRef.current.processTopupPayment!(params),
    [],
  )

  const attachBusinessDetails = useCallback(
    (params: {
      paymentIntentId: string
      customerRef?: string
      isBusiness: boolean
      businessName?: string
      country?: string
      taxId?: string
      taxIdType?: import('@solvapay/core').TaxIdType
    }) => transportRef.current.attachBusinessDetails!(params),
    [],
  )

  const [hasAttachBusinessDetails, setHasAttachBusinessDetails] = useState<boolean>(
    () => !!transportRef.current.attachBusinessDetails,
  )
  useEffect(() => {
    // MCP mode: identity already resolved by the OAuth bridge and carried
    // on `config.initial`. Skip the polling auth loop — nothing would
    // change and the extra `getToken` calls add no signal.
    if (configRef.current?.initial) {
      setIsAuthenticated(configRef.current.initial.customerRef !== null)
      return
    }

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
        if (!transportRef.current.checkPurchase) {
          // MCP transport: purchase snapshot arrives on the bootstrap.
          // Clear loading flags and leave the seeded state untouched.
          setLoading(false)
          setIsRefetching(false)
          loadedCacheKeysRef.current.add(cacheKey)
          inFlightRef.current = null
          return
        }
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

  // Forward ref for `applyInitial` — declared lower in the file but
  // needed inside `refetchPurchase`'s MCP branch. The ref is populated
  // by a `useEffect` below once `applyInitial` is constructed.
  const applyInitialRef = useRef<((next: SolvaPayProviderInitial) => void) | null>(null)

  const upsertPurchase = useCallback((incoming: PurchaseInfo) => {
    setPurchaseData(prev => {
      const next = prev.purchases.filter(p => p.reference !== incoming.reference)
      next.push(incoming)
      return { ...prev, purchases: filterPurchases(next) }
    })
  }, [])

  const refetchPurchase = useCallback(async () => {
    inFlightRef.current = null

    // MCP transport has no `checkPurchase` endpoint — purchase
    // snapshots arrive via the bootstrap tool, which we can replay
    // through `config.refreshInitial`. Without this the MCP branch of
    // `fetchPurchase` no-ops on `force=true`, so callers waiting for a
    // freshly paid purchase to materialise (e.g. `<PaymentForm>`'s
    // post-confirm polling) time out against stale provider state.
    const refresh = configRef.current?.refreshInitial
    const hasCheckPurchase = !!transportRef.current.checkPurchase
    if (refresh && !hasCheckPurchase) {
      setIsRefetching(true)
      try {
        const next = await refresh()
        if (next) applyInitialRef.current?.(next)
      } catch (err) {
        console.error('[SolvaPayProvider] refetchPurchase (MCP) failed:', err)
      } finally {
        setIsRefetching(false)
      }
      return
    }

    await fetchPurchaseRef.current(true)
  }, [])

  const applyInitial = useCallback((next: SolvaPayProviderInitial) => {
    setPurchaseData({
      // Mirror the HTTP path: strip non-active rows before any
      // derivation (`activePurchase` etc.) reads the array.
      purchases: filterPurchases(
        (next.purchase?.purchases ?? []) as unknown as CustomerPurchaseData['purchases'],
      ),
      customerRef: next.customerRef ?? next.purchase?.customerRef,
      email: next.purchase?.email,
      name: next.purchase?.name,
    })
    if (next.customerRef) {
      setInternalCustomerRef(next.customerRef)
      loadedCacheKeysRef.current.add(next.customerRef)
    } else {
      // Refreshed snapshot reports the session as unauthenticated —
      // drop the stale ref so the context doesn't hand consumers an
      // out-of-date customerRef and the fetch-effect guard
      // (`isAuthenticated || internalCustomerRef`) correctly short-
      // circuits.
      setInternalCustomerRef(undefined)
      loadedCacheKeysRef.current.clear()
    }
    setIsAuthenticated(next.customerRef !== null)
    setCreditsValue(next.balance?.credits ?? null)
    setDisplayCurrencyValue(next.balance?.displayCurrency ?? null)
    setCreditsPerMinorUnitValue(next.balance?.creditsPerMinorUnit ?? null)
    setDisplayExchangeRateValue(next.balance?.displayExchangeRate ?? null)
    setDisplayBlockValue(next.balance?.display ?? null)
    balanceLoadedRef.current = !!next.balance
  }, [])

  useEffect(() => {
    applyInitialRef.current = applyInitial
  }, [applyInitial])

  const refreshBootstrap = useCallback(async () => {
    // MCP mode: re-invoke the host's bootstrap producer and re-apply
    // the snapshot. `configRef.current.refreshInitial` is wired by
    // `<McpApp>` to call `fetchMcpBootstrap(app)` again.
    const refresh = configRef.current?.refreshInitial
    if (refresh) {
      try {
        const next = await refresh()
        if (next) applyInitial(next)
      } catch (err) {
        console.error('[SolvaPayProvider] refreshBootstrap failed:', err)
      }
      return
    }
    // HTTP mode: no bootstrap tool — refetch via transport.
    await Promise.all([refetchPurchase(), fetchBalanceRef.current?.() ?? Promise.resolve()])
  }, [refetchPurchase, applyInitial])

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

  const hydratedFromInitialRef = useRef(!!initial)
  useEffect(() => {
    inFlightRef.current = null

    // In MCP mode the initial snapshot is authoritative — skip the
    // first-mount `fetchPurchase` so we don't fire `check_purchase` (the
    // tool may not exist after Phase 2c) and so refetches after
    // mutations flip `isRefetching` rather than `loading`.
    if (hydratedFromInitialRef.current) {
      hydratedFromInitialRef.current = false
      return
    }

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
    // Plans and balance transactions are orthogonal — filter non-plan rows
    // out of every plan-shaped accessor so credit top-ups don't masquerade
    // as a subscription. `purchases` (raw) stays unchanged for integrators
    // who want to classify themselves.
    const planPurchases = purchaseData.purchases.filter(isPlanPurchase)
    const balanceTransactions = purchaseData.purchases.filter(p => !isPlanPurchase(p))

    const activePurchase = getPrimaryPurchase(planPurchases)

    const activePaidPurchases = planPurchases.filter(
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
        return planPurchases.some(
          p => p.productName.toLowerCase() === productName.toLowerCase() && p.status === 'active',
        )
      },
      activePurchase,
      hasPaidPurchase: activePaidPurchases.length > 0,
      activePaidPurchase,
      balanceTransactions,
    }
  }, [loading, isRefetching, purchaseError, purchaseData, internalCustomerRef])

  const balance: BalanceStatus = useMemo(
    () => ({
      loading: balanceLoading,
      credits: creditsValue,
      displayCurrency: displayCurrencyValue,
      creditsPerMinorUnit: creditsPerMinorUnitValue,
      displayExchangeRate: displayExchangeRateValue,
      display: displayBlockValue,
      refetch: fetchBalanceImpl,
      adjustBalance: adjustBalanceImpl,
      reconcileAfterUsageDebit: reconcileAfterUsageDebitImpl,
    }),
    [
      balanceLoading,
      creditsValue,
      displayCurrencyValue,
      creditsPerMinorUnitValue,
      displayExchangeRateValue,
      displayBlockValue,
      fetchBalanceImpl,
      adjustBalanceImpl,
      reconcileAfterUsageDebitImpl,
    ],
  )

  const contextValue: SolvaPayContextValue = useMemo(
    () => ({
      purchase,
      refetchPurchase,
      upsertPurchase,
      createPayment,
      processPayment,
      createTopupPayment,
      processTopupPayment: hasProcessTopupPayment ? processTopupPayment : undefined,
      attachBusinessDetails: hasAttachBusinessDetails
        ? attachBusinessDetails
        : undefined,
      cancelRenewal,
      reactivateRenewal,
      activatePlan,
      customerRef: purchaseData.customerRef || internalCustomerRef,
      updateCustomerRef,
      balance,
      refreshBootstrap,
      _config: configRef.current,
    }),
    [
      purchase,
      refetchPurchase,
      upsertPurchase,
      createPayment,
      processPayment,
      createTopupPayment,
      processTopupPayment,
      hasProcessTopupPayment,
      attachBusinessDetails,
      hasAttachBusinessDetails,
      cancelRenewal,
      reactivateRenewal,
      activatePlan,
      purchaseData.customerRef,
      internalCustomerRef,
      updateCustomerRef,
      balance,
      refreshBootstrap,
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
