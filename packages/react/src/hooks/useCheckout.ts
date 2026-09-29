import { useState, useCallback, useRef } from 'react'
import { useSolvaPay } from './useSolvaPay'
import { buildRequestHeaders } from '../utils/headers'
import { readErrorMessage } from '../utils/readErrorMessage'
import { usePlanSelection } from '../components/PlanSelectionContext'
import type { Plan, PrefillCustomer, SolvaPayConfig, VaultInfo } from '../types'

export interface UseCheckoutReturn {
  loading: boolean
  error: Error | null
  processorPaymentId: string | null
  /** SolvaPay payment intent id; `null` until `createPayment` resolves. */
  paymentIntentId: string | null
  /** The vault `PaymentForm.CardFields` write into; `null` until the intent exists. */
  vault: VaultInfo | null
  resolvedPlanRef: string | null
  startCheckout: () => Promise<void>
  reset: () => void
}

/**
 * Resolve a plan reference when the caller omitted planRef.
 *
 * Strategy:
 * 1. Fetch all plans for the product via the same API route PricingSelector uses.
 * 2. Filter to active plans.
 * 3. If exactly one → use it.
 * 4. If multiple → pick the one flagged `default: true`.
 * 5. Otherwise → throw with an actionable message.
 */
async function resolvePlanRef(
  productRef: string,
  config: SolvaPayConfig | undefined,
): Promise<string> {
  const listPlansRoute = config?.api?.listPlans || '/api/list-plans'
  const url = `${listPlansRoute}?productRef=${encodeURIComponent(productRef)}`
  const fetchFn = config?.fetch || fetch
  const { headers } = await buildRequestHeaders(config)
  const res = await fetchFn(url, { method: 'GET', headers })

  if (!res.ok) {
    const message = await readErrorMessage(
      res,
      `Failed to fetch plans for product "${productRef}"`,
    )
    throw new Error(message)
  }

  const data = (await res.json()) as { plans?: Plan[] }
  const allPlans = data.plans ?? []
  const activePlans = allPlans.filter(p => p.isActive !== false && p.status !== 'inactive')

  if (activePlans.length === 0) {
    throw new Error(
      `No active plans found for product "${productRef}". ` +
        'Configure at least one plan in the SolvaPay Console.',
    )
  }

  if (activePlans.length === 1) {
    return activePlans[0].reference
  }

  const defaultPlan = activePlans.find(p => p.default === true)
  if (defaultPlan) {
    return defaultPlan.reference
  }

  throw new Error(
    `Product "${productRef}" has ${activePlans.length} active plans but none is marked as default. ` +
      'Either pass planRef explicitly, use <PricingSelector> for user selection, ' +
      'or mark one plan as default in the SolvaPay Console.',
  )
}

/**
 * Hook to manage checkout flow for payment processing.
 *
 * Handles payment intent creation. When `planRef`
 * is omitted but `productRef` is provided, the hook auto-resolves the plan
 * by fetching the product's plans and selecting the single/default one.
 *
 * @param options - Checkout options
 * @param options.planRef - Plan reference (optional if product has single/default plan)
 * @param options.productRef - Product reference (required when planRef is omitted)
 * @returns Checkout state and methods
 *
 * @example
 * ```tsx
 * // Explicit planRef (no resolution needed)
 * const checkout = useCheckout({ planRef: 'pln_premium', productRef: 'prd_myapi' })
 *
 * // Auto-resolve plan from product (single plan or default plan)
 * const checkout = useCheckout({ productRef: 'prd_myapi' })
 * ```
 */
export function useCheckout(options: {
  planRef?: string
  productRef?: string
  currency?: string
  customer?: PrefillCustomer
}): UseCheckoutReturn {
  const { planRef, productRef, currency: currencyOverride, customer } = options
  const planSelection = usePlanSelection()
  const { createPayment, customerRef, updateCustomerRef, _config } = useSolvaPay()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [processorPaymentId, setProcessorPaymentId] = useState<string | null>(null)
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null)
  const [vault, setVault] = useState<VaultInfo | null>(null)
  const [resolvedPlanRef, setResolvedPlanRef] = useState<string | null>(planRef || null)
  const isStartingRef = useRef(false)

  const startCheckout = useCallback(async () => {
    if (isStartingRef.current || loading) {
      return
    }

    if (!planRef && !productRef) {
      setError(
        new Error(
          'useCheckout: either planRef or productRef is required. ' +
            'Pass planRef directly, or pass productRef to auto-resolve the plan.',
        ),
      )
      return
    }

    isStartingRef.current = true
    setLoading(true)
    setError(null)

    try {
      let effectivePlanRef = planRef

      if (!effectivePlanRef && productRef) {
        effectivePlanRef = await resolvePlanRef(productRef, _config)
        setResolvedPlanRef(effectivePlanRef)
      }

      if (!effectivePlanRef) {
        throw new Error('Could not determine plan reference for checkout')
      }

      const selectedCurrency = currencyOverride ?? planSelection?.selectedCurrency ?? undefined
      const result = await createPayment({
        planRef: effectivePlanRef,
        productRef,
        ...(selectedCurrency && { currency: selectedCurrency }),
        customer,
      })

      if (!result || typeof result !== 'object') {
        throw new Error('Invalid payment intent response from server')
      }

      if (result.customerRef && result.customerRef !== customerRef && updateCustomerRef) {
        updateCustomerRef(result.customerRef)
      }

      // The card is captured into the vault by `PaymentForm.CardFields` and
      // the payment is confirmed server-side.
      if (!result.id || typeof result.id !== 'string') {
        throw new Error('Invalid payment intent id in payment intent response')
      }
      if (!result.vault?.tenantId || !result.vault.environment) {
        throw new Error('Invalid vault in payment intent response')
      }
      setVault({ tenantId: result.vault.tenantId, environment: result.vault.environment })
      setPaymentIntentId(result.id)
      if (result.processorPaymentId) {
        setProcessorPaymentId(result.processorPaymentId)
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to start checkout')
      setError(error)
    } finally {
      setLoading(false)
      isStartingRef.current = false
    }
  }, [
    planRef,
    productRef,
    currencyOverride,
    planSelection?.selectedCurrency,
    customer,
    createPayment,
    updateCustomerRef,
    loading,
    _config,
  ])

  const reset = useCallback(() => {
    isStartingRef.current = false
    setLoading(false)
    setError(null)
    setProcessorPaymentId(null)
    setPaymentIntentId(null)
    setVault(null)
    setResolvedPlanRef(planRef || null)
  }, [planRef])

  return {
    loading,
    error,
    processorPaymentId,
    paymentIntentId,
    vault,
    resolvedPlanRef,
    startCheckout,
    reset,
  }
}
