import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { UpdatePaymentMethodButton } from './UpdatePaymentMethodButton'
import { SolvaPayContext } from '../SolvaPayProvider'
import type { SolvaPayContextValue, SolvaPayConfig } from '../types'

function buildCtxWithTransport(
  overrides: Partial<SolvaPayConfig['transport']>,
): SolvaPayContextValue {
  const transport = {
    checkPurchase: vi.fn(),
    createPayment: vi.fn(),
    processPayment: vi.fn(),
    createTopupPayment: vi.fn(),
    getBalance: vi.fn(),
    cancelRenewal: vi.fn(),
    reactivateRenewal: vi.fn(),
    activatePlan: vi.fn(),
    createCheckoutSession: vi.fn(),
    createCustomerSession: vi
      .fn()
      .mockResolvedValue({ customerUrl: 'https://portal.test' }),
    getMerchant: vi.fn(),
    getProduct: vi.fn(),
    listPlans: vi.fn(),
    getPaymentMethod: vi.fn(),
    ...overrides,
  }
  return {
    purchase: {
      loading: false,
      isRefetching: false,
      error: null,
      purchases: [],
      hasProduct: () => false,
      activePurchase: null,
      hasPaidPurchase: false,
      activePaidPurchase: null,
      balanceTransactions: [],
    },
    refetchPurchase: vi.fn(),
    createPayment: vi.fn(),
    createTopupPayment: vi.fn(),
    cancelRenewal: vi.fn(),
    reactivateRenewal: vi.fn(),
    activatePlan: vi.fn(),
    balance: {
      loading: false,
      credits: null,
      displayCurrency: null,
      creditsPerMinorUnit: null,
      displayExchangeRate: null,
      refetch: vi.fn(),
      adjustBalance: vi.fn(),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _config: { transport: transport as any },
  }
}

describe('UpdatePaymentMethodButton', () => {
  it('renders an enabled portal-launching anchor immediately and resolves the URL lazily', async () => {
    const ctx = buildCtxWithTransport({})

    render(
      <SolvaPayContext.Provider value={ctx}>
        <UpdatePaymentMethodButton />
      </SolvaPayContext.Provider>,
    )

    const link = screen.getByRole('link')
    expect(link.textContent).toContain('Update card')
    expect(link.getAttribute('data-solvapay-update-payment-method')).toBe('')

    await waitFor(() => expect(link.getAttribute('href')).toBe('https://portal.test'))
  })

  it('accepts custom children as the label', async () => {
    const ctx = buildCtxWithTransport({})

    render(
      <SolvaPayContext.Provider value={ctx}>
        <UpdatePaymentMethodButton>Change billing</UpdatePaymentMethodButton>
      </SolvaPayContext.Provider>,
    )

    const link = await screen.findByRole('link')
    expect(link.textContent).toContain('Change billing')
  })

  it('throws a descriptive error for unimplemented modes so future callers do not silently break', () => {
    const ctx = buildCtxWithTransport({})

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      render(
        <SolvaPayContext.Provider value={ctx}>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <UpdatePaymentMethodButton mode={'inline' as any} />
        </SolvaPayContext.Provider>,
      ),
    ).toThrow(/not implemented yet/i)
    spy.mockRestore()
  })

  it('propagates transport failures via onError when the click-time fetch fails', async () => {
    const createCustomerSession = vi.fn().mockRejectedValue(new Error('boom'))
    const ctx = buildCtxWithTransport({ createCustomerSession })
    const onError = vi.fn()

    render(
      <SolvaPayContext.Provider value={ctx}>
        <UpdatePaymentMethodButton onError={onError} />
      </SolvaPayContext.Provider>,
    )

    await waitFor(() => expect(createCustomerSession).toHaveBeenCalled())

    await act(async () => {
      fireEvent.click(screen.getByRole('link'))
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitFor(() => expect(onError).toHaveBeenCalled())
    expect(onError.mock.calls[0][0].message).toBe('boom')
  })
})
