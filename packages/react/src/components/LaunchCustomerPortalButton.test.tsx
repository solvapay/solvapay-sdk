import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
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
    ...overrides,
  }
}

function buildTransport(overrides: Partial<SolvaPayConfig['transport']> = {}) {
  return {
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
    ...overrides,
  }
}

function renderWithTransport(
  transport: Partial<SolvaPayConfig['transport']>,
  props: Parameters<typeof LaunchCustomerPortalButton>[0] = {},
) {
  const fullTransport = buildTransport(transport)
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

  it('renders an enabled link immediately and fetches the portal URL lazily', async () => {
    const createCustomerSession = vi
      .fn()
      .mockResolvedValue({ customerUrl: 'https://portal.solvapay.test/session-abc' })

    renderWithTransport({ createCustomerSession })

    // Visible at first paint — no disabled "Loading…" placeholder.
    expect(screen.getByRole('link')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(createCustomerSession).toHaveBeenCalledTimes(1)

    await waitFor(() => {
      const link = screen.getByRole('link')
      expect(link.getAttribute('href')).toBe('https://portal.solvapay.test/session-abc')
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toBe('noopener noreferrer')
      expect(link.getAttribute('data-state')).toBe('ready')
    })
  })

  it('keeps the link interactive while the fetch is in flight (no disabled state)', () => {
    let resolveFetch: (v: { customerUrl: string }) => void = () => {}
    const createCustomerSession = vi.fn(
      () =>
        new Promise<{ customerUrl: string }>(resolve => {
          resolveFetch = resolve
        }),
    )

    renderWithTransport({ createCustomerSession })

    const link = screen.getByRole('link')
    expect(link.getAttribute('data-state')).toBe('idle')
    expect(link.hasAttribute('href')).toBe(false)
    expect(link).not.toHaveAttribute('aria-disabled')

    resolveFetch({ customerUrl: 'https://portal.solvapay.test/ready' })
  })

  it('holds the click and falls back to window.open when the URL has not resolved yet', async () => {
    let resolveFetch: (v: { customerUrl: string }) => void = () => {}
    const createCustomerSession = vi.fn(
      () =>
        new Promise<{ customerUrl: string }>(resolve => {
          resolveFetch = resolve
        }),
    )
    const windowOpen = vi.spyOn(window, 'open').mockReturnValue(null)
    const onLaunch = vi.fn()

    renderWithTransport({ createCustomerSession }, { onLaunch })

    const link = screen.getByRole('link')
    fireEvent.click(link)

    expect(windowOpen).not.toHaveBeenCalled()

    await act(async () => {
      resolveFetch({ customerUrl: 'https://portal.solvapay.test/late' })
    })

    await waitFor(() => {
      expect(windowOpen).toHaveBeenCalledWith(
        'https://portal.solvapay.test/late',
        '_blank',
        'noopener,noreferrer',
      )
    })
    expect(onLaunch).toHaveBeenCalledWith('https://portal.solvapay.test/late')
    windowOpen.mockRestore()
  })

  it('shares a single createCustomerSession call across multiple instances under the same transport', async () => {
    const createCustomerSession = vi
      .fn()
      .mockResolvedValue({ customerUrl: 'https://portal.solvapay.test/shared' })
    const fullTransport = buildTransport({ createCustomerSession })
    const ctx = buildCtx({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _config: { transport: fullTransport as any },
    })

    render(
      <SolvaPayContext.Provider value={ctx}>
        <LaunchCustomerPortalButton />
        <LaunchCustomerPortalButton>Update card</LaunchCustomerPortalButton>
      </SolvaPayContext.Provider>,
    )

    await waitFor(() => expect(screen.getAllByRole('link')).toHaveLength(2))
    expect(createCustomerSession).toHaveBeenCalledTimes(1)
    for (const link of screen.getAllByRole('link')) {
      expect(link.getAttribute('href')).toBe('https://portal.solvapay.test/shared')
    }
  })

  it('fires onLaunch with the href when the ready anchor is clicked (synchronous navigation)', async () => {
    const createCustomerSession = vi.fn().mockResolvedValue({
      customerUrl: 'https://portal.solvapay.test/launch',
    })
    const onLaunch = vi.fn()

    renderWithTransport({ createCustomerSession }, { onLaunch })

    await waitFor(() =>
      expect(screen.getByRole('link').getAttribute('data-state')).toBe('ready'),
    )
    fireEvent.click(screen.getByRole('link'))

    expect(onLaunch).toHaveBeenCalledWith('https://portal.solvapay.test/launch')
  })

  it('asChild swaps the ready-state shell for a consumer <button>', async () => {
    const createCustomerSession = vi.fn().mockResolvedValue({
      customerUrl: 'https://portal.solvapay.test/as-child',
    })
    const onLaunch = vi.fn()

    renderWithTransport(
      { createCustomerSession },
      {
        asChild: true,
        onLaunch,
        children: <button data-testid="custom-btn">Open portal</button>,
        // @ts-expect-error — asChild intentionally accepts arbitrary child shells
      } as Parameters<typeof LaunchCustomerPortalButton>[0],
    )

    const btn = await screen.findByTestId('custom-btn')
    expect(btn.tagName).toBe('BUTTON')
    await waitFor(() =>
      expect(btn.getAttribute('href')).toBe('https://portal.solvapay.test/as-child'),
    )
    expect(btn.getAttribute('target')).toBe('_blank')
    expect(btn.getAttribute('rel')).toBe('noopener noreferrer')
    fireEvent.click(btn)
    expect(onLaunch).toHaveBeenCalledWith('https://portal.solvapay.test/as-child')
  })

  it('keeps rendering the link and surfaces error className on a failed click-time fetch', async () => {
    const createCustomerSession = vi
      .fn()
      .mockRejectedValue(new Error('customer_ref missing'))
    const onError = vi.fn()

    renderWithTransport(
      { createCustomerSession },
      { onError, errorClassName: 'is-error' },
    )

    // Wait for the eager fetch to settle into the error state.
    await waitFor(() => expect(createCustomerSession).toHaveBeenCalled())

    const link = screen.getByRole('link')
    expect(link).toBeTruthy()
    expect(link.hasAttribute('href')).toBe(false)

    // Clicking after the eager error retries via ensure(). The retry
    // also rejects, so onError fires and the error className flips on.
    await act(async () => {
      fireEvent.click(link)
      // Allow the rejected ensure() promise to settle.
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(onError).toHaveBeenCalled()
      expect(onError.mock.calls[0][0].message).toBe('customer_ref missing')
      expect(screen.getByRole('link').className).toContain('is-error')
    })
  })
})
