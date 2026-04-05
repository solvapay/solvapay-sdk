import { useState, useCallback, useRef } from 'react'
import { loadStripe, Stripe } from '@stripe/stripe-js'
import { useSolvaPay } from './useSolvaPay'
import type { UseTopupReturn, UseTopupOptions } from '../types'

const stripePromiseCache = new Map<string, Promise<Stripe | null>>()

function getStripeCacheKey(publishableKey: string, accountId?: string): string {
  return accountId ? `${publishableKey}:${accountId}` : publishableKey
}

/**
 * Hook to manage credit top-up flow.
 *
 * Handles payment intent creation (with `purpose: 'credit_topup'`) and
 * Stripe initialization. Unlike `useCheckout`, there is no plan resolution
 * and no `processPayment` step — credits are recorded via webhook.
 *
 * @param options.amount - Amount in smallest currency unit (e.g. cents)
 * @param options.currency - ISO 4217 currency code (default: 'usd')
 */
export function useTopup(options: UseTopupOptions): UseTopupReturn {
  const { amount, currency } = options
  const { createTopupPayment, customerRef, updateCustomerRef } = useSolvaPay()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const isStartingRef = useRef(false)

  const startTopup = useCallback(async () => {
    if (isStartingRef.current || loading) {
      return
    }

    if (!amount || amount <= 0) {
      setError(new Error('useTopup: amount must be a positive number'))
      return
    }

    isStartingRef.current = true
    setLoading(true)
    setError(null)

    try {
      const result = await createTopupPayment({ amount, currency })

      if (!result || typeof result !== 'object') {
        throw new Error('Invalid topup payment intent response from server')
      }

      if (!result.clientSecret || typeof result.clientSecret !== 'string') {
        throw new Error('Invalid client secret in topup payment intent response')
      }

      if (!result.publishableKey || typeof result.publishableKey !== 'string') {
        throw new Error('Invalid publishable key in topup payment intent response')
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
      const error = err instanceof Error ? err : new Error('Failed to start topup')
      setError(error)
    } finally {
      setLoading(false)
      isStartingRef.current = false
    }
  }, [amount, currency, createTopupPayment, customerRef, updateCustomerRef, loading])

  const reset = useCallback(() => {
    isStartingRef.current = false
    setLoading(false)
    setError(null)
    setStripePromise(null)
    setClientSecret(null)
  }, [])

  return {
    loading,
    error,
    stripePromise,
    clientSecret,
    startTopup,
    reset,
  }
}
