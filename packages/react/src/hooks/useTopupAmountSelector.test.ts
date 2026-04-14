import { renderHook, act } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { useTopupAmountSelector } from './useTopupAmountSelector'

describe('useTopupAmountSelector', () => {
  describe('quick amounts', () => {
    it('returns default quick amounts for USD', () => {
      const { result } = renderHook(() => useTopupAmountSelector({ currency: 'usd' }))
      expect(result.current.quickAmounts).toEqual([10, 50, 100, 500])
    })

    it('returns Scandinavian presets for SEK', () => {
      const { result } = renderHook(() => useTopupAmountSelector({ currency: 'SEK' }))
      expect(result.current.quickAmounts).toEqual([100, 500, 1000, 5000])
    })

    it('returns Scandinavian presets for NOK', () => {
      const { result } = renderHook(() => useTopupAmountSelector({ currency: 'NOK' }))
      expect(result.current.quickAmounts).toEqual([100, 500, 1000, 5000])
    })

    it('returns Scandinavian presets for DKK', () => {
      const { result } = renderHook(() => useTopupAmountSelector({ currency: 'DKK' }))
      expect(result.current.quickAmounts).toEqual([100, 500, 1000, 5000])
    })

    it('returns JPY presets', () => {
      const { result } = renderHook(() => useTopupAmountSelector({ currency: 'JPY' }))
      expect(result.current.quickAmounts).toEqual([1000, 5000, 10000, 50000])
    })

    it('returns KRW presets', () => {
      const { result } = renderHook(() => useTopupAmountSelector({ currency: 'KRW' }))
      expect(result.current.quickAmounts).toEqual([10000, 50000, 100000, 500000])
    })

    it('returns large-denomination presets for ISK', () => {
      const { result } = renderHook(() => useTopupAmountSelector({ currency: 'ISK' }))
      expect(result.current.quickAmounts).toEqual([1000, 5000, 10000, 50000])
    })

    it('returns large-denomination presets for HUF', () => {
      const { result } = renderHook(() => useTopupAmountSelector({ currency: 'HUF' }))
      expect(result.current.quickAmounts).toEqual([1000, 5000, 10000, 50000])
    })

    it('is case-insensitive', () => {
      const { result } = renderHook(() => useTopupAmountSelector({ currency: 'sek' }))
      expect(result.current.quickAmounts).toEqual([100, 500, 1000, 5000])
    })

    it('falls back to default for unknown currency', () => {
      const { result } = renderHook(() => useTopupAmountSelector({ currency: 'XYZ' }))
      expect(result.current.quickAmounts).toEqual([10, 50, 100, 500])
    })
  })

  describe('currency symbol', () => {
    it('returns $ for USD', () => {
      const { result } = renderHook(() => useTopupAmountSelector({ currency: 'USD' }))
      expect(result.current.currencySymbol).toBe('$')
    })

    it('returns the currency code for invalid currencies', () => {
      const { result } = renderHook(() => useTopupAmountSelector({ currency: 'INVALID' }))
      expect(result.current.currencySymbol).toBe('INVALID')
    })
  })

  describe('initial state', () => {
    it('starts with no selection', () => {
      const { result } = renderHook(() => useTopupAmountSelector({ currency: 'usd' }))
      expect(result.current.selectedAmount).toBeNull()
      expect(result.current.customAmount).toBe('')
      expect(result.current.resolvedAmount).toBeNull()
      expect(result.current.error).toBeNull()
    })
  })

  describe('selectQuickAmount', () => {
    it('sets selectedAmount and resolvedAmount', () => {
      const { result } = renderHook(() => useTopupAmountSelector({ currency: 'usd' }))

      act(() => result.current.selectQuickAmount(50))

      expect(result.current.selectedAmount).toBe(50)
      expect(result.current.resolvedAmount).toBe(50)
      expect(result.current.customAmount).toBe('')
    })

    it('clears custom amount when selecting a quick amount', () => {
      const { result } = renderHook(() => useTopupAmountSelector({ currency: 'usd' }))

      act(() => result.current.setCustomAmount('75'))
      expect(result.current.customAmount).toBe('75')

      act(() => result.current.selectQuickAmount(100))
      expect(result.current.customAmount).toBe('')
      expect(result.current.selectedAmount).toBe(100)
      expect(result.current.resolvedAmount).toBe(100)
    })

    it('clears any existing error', () => {
      const { result } = renderHook(() => useTopupAmountSelector({ currency: 'usd' }))

      act(() => result.current.validate())
      expect(result.current.error).not.toBeNull()

      act(() => result.current.selectQuickAmount(10))
      expect(result.current.error).toBeNull()
    })
  })

  describe('setCustomAmount', () => {
    it('sets customAmount and resolvedAmount', () => {
      const { result } = renderHook(() => useTopupAmountSelector({ currency: 'usd' }))

      act(() => result.current.setCustomAmount('75'))

      expect(result.current.customAmount).toBe('75')
      expect(result.current.resolvedAmount).toBe(75)
      expect(result.current.selectedAmount).toBeNull()
    })

    it('clears selectedAmount when entering custom value', () => {
      const { result } = renderHook(() => useTopupAmountSelector({ currency: 'usd' }))

      act(() => result.current.selectQuickAmount(50))
      expect(result.current.selectedAmount).toBe(50)

      act(() => result.current.setCustomAmount('25'))
      expect(result.current.selectedAmount).toBeNull()
      expect(result.current.resolvedAmount).toBe(25)
    })

    it('strips non-numeric characters', () => {
      const { result } = renderHook(() => useTopupAmountSelector({ currency: 'usd' }))

      act(() => result.current.setCustomAmount('$1,234.56'))
      expect(result.current.customAmount).toBe('1234.56')
    })

    it('allows decimal values', () => {
      const { result } = renderHook(() => useTopupAmountSelector({ currency: 'usd' }))

      act(() => result.current.setCustomAmount('99.99'))
      expect(result.current.customAmount).toBe('99.99')
      expect(result.current.resolvedAmount).toBe(99.99)
    })

    it('only allows one decimal point', () => {
      const { result } = renderHook(() => useTopupAmountSelector({ currency: 'usd' }))

      act(() => result.current.setCustomAmount('12.34.56'))
      expect(result.current.customAmount).toBe('12.3456')
    })

    it('resolvedAmount is null for non-positive input', () => {
      const { result } = renderHook(() => useTopupAmountSelector({ currency: 'usd' }))

      act(() => result.current.setCustomAmount('0'))
      expect(result.current.resolvedAmount).toBeNull()

      act(() => result.current.setCustomAmount(''))
      expect(result.current.resolvedAmount).toBeNull()
    })

    it('resolvedAmount is null for non-numeric input', () => {
      const { result } = renderHook(() => useTopupAmountSelector({ currency: 'usd' }))

      act(() => result.current.setCustomAmount('abc'))
      expect(result.current.customAmount).toBe('')
      expect(result.current.resolvedAmount).toBeNull()
    })

    it('clears any existing error', () => {
      const { result } = renderHook(() => useTopupAmountSelector({ currency: 'usd' }))

      act(() => result.current.validate())
      expect(result.current.error).not.toBeNull()

      act(() => result.current.setCustomAmount('50'))
      expect(result.current.error).toBeNull()
    })
  })

  describe('resolvedAmount', () => {
    it('prefers custom amount over selected amount', () => {
      const { result } = renderHook(() => useTopupAmountSelector({ currency: 'usd' }))

      act(() => result.current.selectQuickAmount(50))
      expect(result.current.resolvedAmount).toBe(50)

      act(() => result.current.setCustomAmount('123'))
      expect(result.current.resolvedAmount).toBe(123)
    })
  })

  describe('validate', () => {
    it('returns false when no amount selected', () => {
      const { result } = renderHook(() => useTopupAmountSelector({ currency: 'usd' }))

      let valid: boolean
      act(() => {
        valid = result.current.validate()
      })
      expect(valid!).toBe(false)
      expect(result.current.error).toBe('Please select or enter an amount')
    })

    it('returns false when below minimum', () => {
      const { result } = renderHook(() =>
        useTopupAmountSelector({ currency: 'usd', minAmount: 5 }),
      )

      act(() => result.current.setCustomAmount('3'))

      let valid: boolean
      act(() => {
        valid = result.current.validate()
      })
      expect(valid!).toBe(false)
      expect(result.current.error).toBe('Minimum amount is $5')
    })

    it('returns false when above maximum', () => {
      const { result } = renderHook(() =>
        useTopupAmountSelector({ currency: 'usd', maxAmount: 1000 }),
      )

      act(() => result.current.setCustomAmount('5000'))

      let valid: boolean
      act(() => {
        valid = result.current.validate()
      })
      expect(valid!).toBe(false)
      expect(result.current.error).toContain('Maximum amount is')
    })

    it('returns true for valid quick amount', () => {
      const { result } = renderHook(() => useTopupAmountSelector({ currency: 'usd' }))

      act(() => result.current.selectQuickAmount(50))

      let valid: boolean
      act(() => {
        valid = result.current.validate()
      })
      expect(valid!).toBe(true)
      expect(result.current.error).toBeNull()
    })

    it('returns true for valid custom amount', () => {
      const { result } = renderHook(() => useTopupAmountSelector({ currency: 'usd' }))

      act(() => result.current.setCustomAmount('250'))

      let valid: boolean
      act(() => {
        valid = result.current.validate()
      })
      expect(valid!).toBe(true)
      expect(result.current.error).toBeNull()
    })

    it('uses default min of 1', () => {
      const { result } = renderHook(() => useTopupAmountSelector({ currency: 'usd' }))

      act(() => result.current.setCustomAmount('0.5'))

      let valid: boolean
      act(() => {
        valid = result.current.validate()
      })
      expect(valid!).toBe(false)
      expect(result.current.error).toBe('Minimum amount is $1')
    })

    it('uses default max of 100,000', () => {
      const { result } = renderHook(() => useTopupAmountSelector({ currency: 'usd' }))

      act(() => result.current.setCustomAmount('200000'))

      let valid: boolean
      act(() => {
        valid = result.current.validate()
      })
      expect(valid!).toBe(false)
      expect(result.current.error).toContain('Maximum amount is')
    })
  })

  describe('reset', () => {
    it('clears all state', () => {
      const { result } = renderHook(() => useTopupAmountSelector({ currency: 'usd' }))

      act(() => result.current.selectQuickAmount(100))
      act(() => result.current.setCustomAmount('75'))
      act(() => result.current.validate())

      act(() => result.current.reset())

      expect(result.current.selectedAmount).toBeNull()
      expect(result.current.customAmount).toBe('')
      expect(result.current.resolvedAmount).toBeNull()
      expect(result.current.error).toBeNull()
    })
  })

  describe('currency reactivity', () => {
    it('updates quick amounts when currency changes', () => {
      const { result, rerender } = renderHook(
        ({ currency }) => useTopupAmountSelector({ currency }),
        { initialProps: { currency: 'usd' } },
      )

      expect(result.current.quickAmounts).toEqual([10, 50, 100, 500])

      rerender({ currency: 'JPY' })
      expect(result.current.quickAmounts).toEqual([1000, 5000, 10000, 50000])
    })

    it('updates currency symbol when currency changes', () => {
      const { result, rerender } = renderHook(
        ({ currency }) => useTopupAmountSelector({ currency }),
        { initialProps: { currency: 'USD' } },
      )

      expect(result.current.currencySymbol).toBe('$')

      rerender({ currency: 'GBP' })
      expect(result.current.currencySymbol).toBe('£')
    })
  })
})
