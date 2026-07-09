import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useBusinessDetailsAttach } from './useBusinessDetailsAttach'
import type { TaxBreakdown } from '@solvapay/core'

const taxBreakdown: TaxBreakdown = {
  subtotal: 1000,
  taxAmount: 250,
  taxRate: 0.25,
  treatment: 'standard',
  total: 1250,
  currency: 'USD',
  inclusive: false,
}

describe('useBusinessDetailsAttach', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns requiresBusinessAttach false when attach transport is absent', () => {
    const { result } = renderHook(() => useBusinessDetailsAttach({ processorPaymentId: 'pi_test' }))
    expect(result.current.requiresBusinessAttach).toBe(false)
  })

  it('debounces auto-attach for consumer details and calls onTaxChange', async () => {
    const attachBusinessDetails = vi.fn().mockResolvedValue({ taxBreakdown })
    const onTaxChange = vi.fn()
    const refreshElements = vi.fn().mockResolvedValue(undefined)

    renderHook(() =>
      useBusinessDetailsAttach({
        processorPaymentId: 'pi_test_123',
        attachBusinessDetails,
        onTaxChange,
        refreshElements,
      }),
    )

    await waitFor(
      () => {
        expect(attachBusinessDetails).toHaveBeenCalledTimes(1)
      },
      { timeout: 2000 },
    )

    expect(attachBusinessDetails).toHaveBeenCalledWith({
      paymentIntentId: 'pi_test_123',
      isBusiness: false,
    })
    expect(onTaxChange).toHaveBeenCalledWith(taxBreakdown)
    expect(refreshElements).toHaveBeenCalled()
  })

  it('does not call refreshElements when not provided', async () => {
    const attachBusinessDetails = vi.fn().mockResolvedValue({ taxBreakdown })

    renderHook(() =>
      useBusinessDetailsAttach({
        processorPaymentId: 'pi_test_123',
        attachBusinessDetails,
      }),
    )

    await waitFor(() => expect(attachBusinessDetails).toHaveBeenCalled(), { timeout: 2000 })
  })

  it('runAttach returns false and sets error when attach rejects', async () => {
    const attachBusinessDetails = vi.fn().mockRejectedValue(new Error('Invalid VAT ID'))

    const { result } = renderHook(() =>
      useBusinessDetailsAttach({
        processorPaymentId: 'pi_test_123',
        attachBusinessDetails,
      }),
    )

    let attached = false
    await act(async () => {
      attached = await result.current.runAttach({
        isBusiness: true,
        businessName: 'Acme AB',
        country: 'SE',
        taxId: 'SE556677889901',
      })
    })

    expect(attached).toBe(false)
    expect(result.current.businessDetailsError).toBe('Invalid VAT ID')
    expect(result.current.businessDetailsAttached).toBe(false)
  })

  it('resets attached state when business details change', async () => {
    const attachBusinessDetails = vi.fn().mockResolvedValue({ taxBreakdown })

    const { result } = renderHook(() =>
      useBusinessDetailsAttach({
        processorPaymentId: 'pi_test_123',
        attachBusinessDetails,
      }),
    )

    await waitFor(() => expect(result.current.businessDetailsAttached).toBe(true), {
      timeout: 2000,
    })

    act(() => {
      result.current.setBusinessDetails({ isBusiness: true })
    })

    expect(result.current.businessDetailsAttached).toBe(false)
  })
})
