import { useState, useCallback, useRef } from 'react'
import { loadStripe, Stripe } from '@stripe/stripe-js'
import { useSolvaPay } from './useSolvaPay'
import type { Plan, PrefillCustomer } from '../types'

export interface UseCheckoutReturn {
  loading: boolean
  error: Error | null
  stripePromise: Promise<Stripe | null> | null
  clientSecret: string | null
  resolvedPlanRef: string | null
  startCheckout: () => Promise<void>
  reset: () => void
}

const stripePromiseCache = new Map<string, Promise<Stripe | null>>()

function getStripeCacheKey(publishableKey: string, accountId?: string): string {
  return accountId ? `${publishableKey}:${accountId}` : publishableKey
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
  fetchFn: typeof fetch,
  headers: HeadersInit,
  listPlansRoute: string,
): Promise<string> {
  const url = `${listPlansRoute}?productRef=${encodeURIComponent(productRef)}`
  const res = await fetchFn(url, { method: 'GET', headers })

  if (!res.ok) {
    throw new Error(`Failed to fetch plans for product "${productRef}": ${res.statusText}`)
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
 * Handles payment intent creation and Stripe initialization. When `planRef`
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
  customer?: PrefillCustomer
}): UseCheckoutReturn {
  const { planRef, productRef, customer } = options
  const { createPayment, customerRef, updateCustomerRef, _config } = useSolvaPay()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
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
        const listPlansRoute = _config?.api?.listPlans || '/api/list-plans'
        effectivePlanRef = await resolvePlanRef(productRef, fetch, {}, listPlansRoute)
        setResolvedPlanRef(effectivePlanRef)
      }

      if (!effectivePlanRef) {
        throw new Error('Could not determine plan reference for checkout')
      }

      const result = await createPayment({
        planRef: effectivePlanRef,
        productRef,
        customer,
      })

      if (!result || typeof result !== 'object') {
        throw new Error('Invalid payment intent response from server')
      }

      if (!result.clientSecret || typeof result.clientSecret !== 'string') {
        throw new Error('Invalid client secret in payment intent response')
      }

      if (!result.publishableKey || typeof result.publishableKey !== 'string') {
        throw new Error('Invalid publishable key in payment intent response')
      }

      if (result.customerRef && result.customerRef !== customerRef && updateCustomerRef) {
        updateCustomerRef(result.customerRef)
      }

      const stripeOptions = result.accountId ? { stripeAccount: result.accountId } : {}

      const cacheKey = getStripeCacheKey(result.publishableKey, result.accountId)
      let stripe = stripePromiseCache.get(cacheKey)

      if (!stripe) {
        stripe = loadStripe(result.publishableKey, stripeOptions)
        stripePromiseCache.set(cacheKey, stripe)
      }

      setStripePromise(stripe)
      setClientSecret(result.clientSecret)
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to start checkout')
      setError(error)
    } finally {
      setLoading(false)
      isStartingRef.current = false
    }
  }, [planRef, productRef, customer, createPayment, updateCustomerRef, loading, _config])

  const reset = useCallback(() => {
    isStartingRef.current = false
    setLoading(false)
    setError(null)
    setStripePromise(null)
    setClientSecret(null)
    setResolvedPlanRef(planRef || null)
  }, [planRef])

  return {
    loading,
    error,
    stripePromise,
    clientSecret,
    resolvedPlanRef,
    startCheckout,
    reset,
  }
}
