import { useState, useCallback, useRef } from 'react'
import { useSolvaPay } from './useSolvaPay'
import type { UseTopupReturn, UseTopupOptions, VaultInfo } from '../types'

/**
 * Hook to manage credit top-up flow.
 *
 * Handles payment intent creation (with `purpose: 'credit_topup'`). Unlike `useCheckout`, there is no plan resolution
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
  const [processorPaymentId, setProcessorPaymentId] = useState<string | null>(null)
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null)
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

      // The card is captured by `TopupForm.CardFields` and the payment
      // confirmed server-side.
      if (!result.id || typeof result.id !== 'string') {
        throw new Error('Invalid payment intent id in topup payment intent response')
      }
      if (!result.vault?.tenantId || !result.vault.environment) {
        throw new Error('Invalid vault in topup payment intent response')
      }
      setVault({ tenantId: result.vault.tenantId, environment: result.vault.environment })
      setPaymentIntentId(result.id)
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
    setProcessorPaymentId(null)
    setPaymentIntentId(null)
    setVault(null)
  }, [])

  return {
    loading,
    error,
    processorPaymentId,
    paymentIntentId,
    vault,
    startTopup,
    reset,
  }
}
