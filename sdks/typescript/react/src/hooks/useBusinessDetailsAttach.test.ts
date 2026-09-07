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

  it('does not auto-attach until a buyer country is selected', async () => {
    const attachBusinessDetails = vi.fn().mockResolvedValue({ taxBreakdown })

    renderHook(() =>
      useBusinessDetailsAttach({
        processorPaymentId: 'pi_test_123',
        attachBusinessDetails,
      }),
    )

    await new Promise(resolve => setTimeout(resolve, 400))
    expect(attachBusinessDetails).not.toHaveBeenCalled()
  })

  it('debounces auto-attach for consumer details and sends customerCountry', async () => {
    const attachBusinessDetails = vi.fn().mockResolvedValue({ taxBreakdown })
    const onTaxChange = vi.fn()
    const refreshElements = vi.fn().mockResolvedValue(undefined)

    const { result } = renderHook(() =>
      useBusinessDetailsAttach({
        processorPaymentId: 'pi_test_123',
        attachBusinessDetails,
        onTaxChange,
        refreshElements,
      }),
    )

    act(() => {
      result.current.setBusinessDetails({ customerCountry: 'SE' })
    })

    await waitFor(
      () => {
        expect(attachBusinessDetails).toHaveBeenCalledTimes(1)
      },
      { timeout: 2000 },
    )

    expect(attachBusinessDetails).toHaveBeenCalledWith({
      paymentIntentId: 'pi_test_123',
      isBusiness: false,
      customerCountry: 'SE',
    })
    expect(onTaxChange).toHaveBeenCalledWith(taxBreakdown)
    expect(refreshElements).toHaveBeenCalled()
  })

  it('sends customerCountry on the business attach payload', async () => {
    const attachBusinessDetails = vi.fn().mockResolvedValue({ taxBreakdown })

    const { result } = renderHook(() =>
      useBusinessDetailsAttach({
        processorPaymentId: 'pi_test_123',
        attachBusinessDetails,
      }),
    )

    act(() => {
      result.current.setBusinessDetails({
        isBusiness: true,
        country: 'SE',
        customerCountry: 'SE',
      })
    })

    await waitFor(
      () => {
        expect(attachBusinessDetails).toHaveBeenCalledWith({
          paymentIntentId: 'pi_test_123',
          isBusiness: true,
          country: 'SE',
          customerCountry: 'SE',
        })
      },
      { timeout: 2000 },
    )
  })

  it('preserves customerCountry when toggling off business', async () => {
    const attachBusinessDetails = vi.fn().mockResolvedValue({ taxBreakdown })
    const { result } = renderHook(() =>
      useBusinessDetailsAttach({
        processorPaymentId: 'pi_test_123',
        attachBusinessDetails,
      }),
    )

    act(() => {
      result.current.setBusinessDetails({ customerCountry: 'SE' })
    })
    act(() => {
      result.current.setBusinessDetails({ isBusiness: true })
    })
    act(() => {
      result.current.setBusinessDetails({ isBusiness: false })
    })

    expect(result.current.businessDetails).toEqual({
      isBusiness: false,
      customerCountry: 'SE',
    })
  })

  it('does not call refreshElements when not provided', async () => {
    const attachBusinessDetails = vi.fn().mockResolvedValue({ taxBreakdown })

    const { result } = renderHook(() =>
      useBusinessDetailsAttach({
        processorPaymentId: 'pi_test_123',
        attachBusinessDetails,
      }),
    )

    act(() => {
      result.current.setBusinessDetails({ customerCountry: 'SE' })
    })

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

    act(() => {
      result.current.setBusinessDetails({ customerCountry: 'SE' })
    })

    await waitFor(() => expect(result.current.businessDetailsAttached).toBe(true), {
      timeout: 2000,
    })

    act(() => {
      result.current.setBusinessDetails({ isBusiness: true })
    })

    expect(result.current.businessDetailsAttached).toBe(false)
  })

  it('surfaces field errors from the attach response rather than a local pre-gate', async () => {
    const attachError = Object.assign(new Error('Invalid VAT ID'), {
      fieldErrors: { taxId: 'Invalid VAT ID' },
    })
    const attachBusinessDetails = vi.fn().mockRejectedValue(attachError)

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
        taxId: 'bad',
      })
    })

    expect(attached).toBe(false)
    expect(attachBusinessDetails).toHaveBeenCalled()
    expect(result.current.fieldErrors.taxId).toBe('Invalid VAT ID')
  })
})
