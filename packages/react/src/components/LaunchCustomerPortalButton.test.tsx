import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { LaunchCustomerPortalButton } from './LaunchCustomerPortalButton'
import { SolvaPayContext } from '../SolvaPayProvider'
import type { SolvaPayContextValue, SolvaPayConfig } from '../types'

function buildCtx(overrides: Partial<SolvaPayContextValue> = {}): SolvaPayContextValue {
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
    ...overrides,
  }
}

function renderWithTransport(
  transport: Partial<SolvaPayConfig['transport']>,
  props: Parameters<typeof LaunchCustomerPortalButton>[0] = {},
) {
  const fullTransport = {
    checkPurchase: vi.fn(),
    createPayment: vi.fn(),
    processPayment: vi.fn(),
    createTopupPayment: vi.fn(),
    getBalance: vi.fn(),
    cancelRenewal: vi.fn(),
    reactivateRenewal: vi.fn(),
    activatePlan: vi.fn(),
    createCheckoutSession: vi.fn(),
    createCustomerSession: vi.fn(),
    getMerchant: vi.fn(),
    getProduct: vi.fn(),
    listPlans: vi.fn(),
    getPaymentMethod: vi.fn(),
    ...transport,
  }
  const ctx = buildCtx({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _config: { transport: fullTransport as any },
  })

  return render(
    <SolvaPayContext.Provider value={ctx}>
      <LaunchCustomerPortalButton {...props} />
    </SolvaPayContext.Provider>,
  )
}

describe('LaunchCustomerPortalButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('pre-fetches the customer portal URL on mount and renders an <a target="_blank">', async () => {
    const createCustomerSession = vi
      .fn()
      .mockResolvedValue({ customerUrl: 'https://portal.solvapay.test/session-abc' })

    renderWithTransport({ createCustomerSession })

    await waitFor(() => expect(createCustomerSession).toHaveBeenCalled())

    const link = await screen.findByRole('link')
    expect(link.getAttribute('href')).toBe('https://portal.solvapay.test/session-abc')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(link.getAttribute('data-state')).toBe('ready')
  })

  it('renders a disabled loading button while the fetch is in flight', async () => {
    let resolveFetch: (v: { customerUrl: string }) => void = () => {}
    const createCustomerSession = vi.fn(
      () =>
        new Promise(resolve => {
          resolveFetch = resolve
        }),
    )

    renderWithTransport({ createCustomerSession })

    const loadingBtn = await screen.findByRole('button')
    expect(loadingBtn.getAttribute('data-state')).toBe('loading')
    expect(loadingBtn).toBeDisabled()

    resolveFetch({ customerUrl: 'https://portal.solvapay.test/ready' })

    await waitFor(() => expect(screen.queryByRole('button')).toBeNull())
  })

  it('fires onLaunch with the href when the anchor is clicked', async () => {
    const createCustomerSession = vi.fn().mockResolvedValue({
      customerUrl: 'https://portal.solvapay.test/launch',
    })
    const onLaunch = vi.fn()

    renderWithTransport({ createCustomerSession }, { onLaunch })

    const link = await screen.findByRole('link')
    fireEvent.click(link)

    expect(onLaunch).toHaveBeenCalledWith('https://portal.solvapay.test/launch')
  })

  it('shows an error state and calls onError when the fetch throws', async () => {
    const createCustomerSession = vi
      .fn()
      .mockRejectedValue(new Error('customer_ref missing'))
    const onError = vi.fn()

    renderWithTransport({ createCustomerSession }, { onError })

    await waitFor(() => {
      const btn = screen.getByRole('button')
      expect(btn.getAttribute('data-state')).toBe('error')
    })
    expect(onError).toHaveBeenCalledWith(expect.any(Error))
    expect(onError.mock.calls[0][0].message).toBe('customer_ref missing')
  })

})
