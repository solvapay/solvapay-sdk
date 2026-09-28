import { useState, useCallback, useRef } from 'react'
import { loadStripe, Stripe, StripeConstructorOptions } from '@stripe/stripe-js'
import { useSolvaPay } from './useSolvaPay'
import type { CaptureMode, UseTopupReturn, UseTopupOptions, VaultInfo } from '../types'

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
  const { amount, currency, autoRecharge } = options
  const { createTopupPayment, customerRef, updateCustomerRef } = useSolvaPay()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [processorPaymentId, setProcessorPaymentId] = useState<string | null>(null)
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null)
  const [captureMode, setCaptureMode] = useState<CaptureMode | null>(null)
  const [vault, setVault] = useState<VaultInfo | null>(null)
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
      const result = await createTopupPayment({ amount, currency, autoRecharge })

      if (!result || typeof result !== 'object') {
        throw new Error('Invalid topup payment intent response from server')
      }

      if (result.customerRef && result.customerRef !== customerRef && updateCustomerRef) {
        updateCustomerRef(result.customerRef)
      }

      if (result.captureMode === 'vault') {
        // Vault mode: the card is captured by `TopupForm.CardFields` and the
        // payment confirmed server-side. No Stripe.js, no client secret.
        if (!result.id || typeof result.id !== 'string') {
          throw new Error('Invalid payment intent id in vault topup payment intent response')
        }
        if (!result.vault?.tenantId || !result.vault.environment) {
          throw new Error('Invalid vault in topup payment intent response')
        }
        setCaptureMode('vault')
        setVault({ tenantId: result.vault.tenantId, environment: result.vault.environment })
        setPaymentIntentId(result.id)
        setClientSecret(null)
        setStripePromise(null)
        if (result.processorPaymentId) {
          setProcessorPaymentId(result.processorPaymentId)
        }
        return
      }

      if (!result.clientSecret || typeof result.clientSecret !== 'string') {
        throw new Error('Invalid client secret in topup payment intent response')
      }

      if (!result.publishableKey || typeof result.publishableKey !== 'string') {
        throw new Error('Invalid publishable key in topup payment intent response')
      }

      const stripeOptions: StripeConstructorOptions = {
        ...(result.accountId ? { stripeAccount: result.accountId } : {}),
        developerTools: { assistant: { enabled: false } },
      }

      const cacheKey = getStripeCacheKey(result.publishableKey, result.accountId)
      let stripe = stripePromiseCache.get(cacheKey)

      if (!stripe) {
        stripe = loadStripe(result.publishableKey, stripeOptions)
        stripePromiseCache.set(cacheKey, stripe)
      }

      setStripePromise(stripe)
      setClientSecret(result.clientSecret)
      setCaptureMode('processor_elements')
      setVault(null)
      if (typeof result.id === 'string' && result.id) {
        setPaymentIntentId(result.id)
      }
      if (result.processorPaymentId) {
        setProcessorPaymentId(result.processorPaymentId)
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to start topup')
      setError(error)
    } finally {
      setLoading(false)
      isStartingRef.current = false
    }
  }, [amount, currency, autoRecharge, createTopupPayment, customerRef, updateCustomerRef, loading])

  const reset = useCallback(() => {
    isStartingRef.current = false
    setLoading(false)
    setError(null)
    setStripePromise(null)
    setClientSecret(null)
    setProcessorPaymentId(null)
    setPaymentIntentId(null)
    setCaptureMode(null)
    setVault(null)
  }, [])

  return {
    loading,
    error,
    stripePromise,
    clientSecret,
    processorPaymentId,
    paymentIntentId,
    captureMode,
    vault,
    startTopup,
    reset,
  }
}
