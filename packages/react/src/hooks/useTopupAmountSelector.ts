import { useState, useCallback, useMemo } from 'react'
import type { UseTopupAmountSelectorOptions, UseTopupAmountSelectorReturn } from '../types'

function getQuickAmounts(currency: string): number[] {
  switch (currency.toUpperCase()) {
    case 'SEK':
    case 'NOK':
    case 'DKK':
      return [100, 500, 1000, 5000]
    case 'JPY':
      return [1000, 5000, 10000, 50000]
    case 'KRW':
      return [10000, 50000, 100000, 500000]
    case 'ISK':
    case 'HUF':
      return [1000, 5000, 10000, 50000]
    default:
      return [10, 50, 100, 500]
  }
}

function getCurrencySymbol(currency: string): string {
  try {
    const parts = new Intl.NumberFormat('en', { style: 'currency', currency }).formatToParts(0)
    const sym = parts.find(p => p.type === 'currency')
    return sym?.value || currency
  } catch {
    return currency
  }
}

const DEFAULT_MIN = 1
const DEFAULT_MAX = 100_000

/**
 * Headless hook for top-up amount selection.
 *
 * Manages quick-pick presets, custom input, mutual exclusivity, and validation.
 * Currency-aware: presets and symbol adjust based on the ISO 4217 code.
 *
 * @example
 * ```tsx
 * const {
 *   quickAmounts, selectedAmount, customAmount,
 *   resolvedAmount, selectQuickAmount, setCustomAmount,
 *   error, validate, reset, currencySymbol,
 * } = useTopupAmountSelector({ currency: 'usd' })
 * ```
 */
export function useTopupAmountSelector(
  options: UseTopupAmountSelectorOptions,
): UseTopupAmountSelectorReturn {
  const { currency, minAmount = DEFAULT_MIN, maxAmount = DEFAULT_MAX } = options

  const [selectedAmount, setSelectedAmount] = useState<number | null>(null)
  const [customAmount, setCustomAmountRaw] = useState('')
  const [error, setError] = useState<string | null>(null)

  const quickAmounts = useMemo(() => getQuickAmounts(currency), [currency])
  const currencySymbol = useMemo(() => getCurrencySymbol(currency), [currency])

  const resolvedAmount = useMemo(() => {
    if (customAmount) {
      const parsed = parseFloat(customAmount)
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null
    }
    return selectedAmount
  }, [selectedAmount, customAmount])

  const selectQuickAmount = useCallback(
    (amount: number) => {
      setSelectedAmount(amount)
      setCustomAmountRaw('')
      setError(null)
    },
    [],
  )

  const setCustomAmount = useCallback(
    (value: string) => {
      const sanitized = value.replace(/[^0-9.]/g, '')
      const dotIndex = sanitized.indexOf('.')
      const cleaned =
        dotIndex === -1
          ? sanitized
          : sanitized.slice(0, dotIndex + 1) + sanitized.slice(dotIndex + 1).replace(/\./g, '')
      setCustomAmountRaw(cleaned)
      setSelectedAmount(null)
      setError(null)
    },
    [],
  )

  const validate = useCallback((): boolean => {
    if (resolvedAmount == null) {
      setError('Please select or enter an amount')
      return false
    }
    if (resolvedAmount < minAmount) {
      setError(`Minimum amount is ${currencySymbol}${minAmount}`)
      return false
    }
    if (resolvedAmount > maxAmount) {
      setError(`Maximum amount is ${currencySymbol}${maxAmount.toLocaleString()}`)
      return false
    }
    setError(null)
    return true
  }, [resolvedAmount, minAmount, maxAmount, currencySymbol])

  const reset = useCallback(() => {
    setSelectedAmount(null)
    setCustomAmountRaw('')
    setError(null)
  }, [])

  return {
    quickAmounts,
    selectedAmount,
    customAmount,
    resolvedAmount,
    selectQuickAmount,
    setCustomAmount,
    error,
    validate,
    reset,
    currencySymbol,
  }
}
