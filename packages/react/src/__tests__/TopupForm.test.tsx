/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { TopupForm } from '../TopupForm'
import { SolvaPayContext } from '../SolvaPayProvider'
import type { SolvaPayContextValue } from '../types'

// Mock Stripe modules
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'stripe-elements' }, children),
  useStripe: () => ({ confirmCardPayment: vi.fn() }),
  useElements: () => ({ getElement: vi.fn() }),
  CardElement: () => React.createElement('div', { 'data-testid': 'card-element' }),
}))

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(() => Promise.resolve({ confirmCardPayment: vi.fn() })),
}))

function createMockContext(overrides?: Partial<SolvaPayContextValue>): SolvaPayContextValue {
  return {
    purchase: {
      loading: false,
      isRefetching: false,
      error: null,
      purchases: [],
      hasProduct: () => false,
      hasPlan: () => false,
      activePurchase: null,
      hasPaidPurchase: false,
      activePaidPurchase: null,
    },
    refetchPurchase: vi.fn(),
    createPayment: vi.fn(),
    createTopupPayment: vi.fn().mockResolvedValue({
      clientSecret: 'pi_topup_secret',
      publishableKey: 'pk_test_123',
    }),
    cancelRenewal: vi.fn(),
    reactivateRenewal: vi.fn(),
    activatePlan: vi.fn(),
    balance: {
      loading: false,
      credits: null,
      displayCurrency: null,
      refetch: vi.fn(),
      adjustBalance: vi.fn(),
    },
    ...overrides,
  }
}

function renderWithProvider(ui: React.ReactElement, context?: Partial<SolvaPayContextValue>) {
  const ctx = createMockContext(context)
  return render(
    React.createElement(SolvaPayContext.Provider, { value: ctx }, ui),
  )
}

describe('TopupForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading state initially when amount is valid', () => {
    renderWithProvider(React.createElement(TopupForm, { amount: 1000 }))
    // Should show spinner / loading button
    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent('Top Up')
  })

  it('shows error when amount is not positive', () => {
    renderWithProvider(React.createElement(TopupForm, { amount: 0 }))
    expect(screen.getByText(/amount must be a positive number/i)).toBeTruthy()
  })

  it('auto-starts topup on mount when amount is provided', async () => {
    const createTopupPayment = vi.fn().mockResolvedValue({
      clientSecret: 'cs_1',
      publishableKey: 'pk_1',
    })
    renderWithProvider(React.createElement(TopupForm, { amount: 2000 }), { createTopupPayment })

    await vi.waitFor(() => {
      expect(createTopupPayment).toHaveBeenCalledWith({ amount: 2000, currency: undefined })
    })
  })

  it('passes submitButtonText prop through', () => {
    renderWithProvider(
      React.createElement(TopupForm, { amount: 1000, submitButtonText: 'Add Credits' }),
    )
    expect(screen.getByRole('button')).toHaveTextContent('Add Credits')
  })

  it('passes className prop through', () => {
    const { container } = renderWithProvider(
      React.createElement(TopupForm, { amount: 1000, className: 'custom-class' }),
    )
    expect(container.firstChild).toHaveClass('custom-class')
  })

  it('renders Stripe Elements when clientSecret is available', async () => {
    const createTopupPayment = vi.fn().mockResolvedValue({
      clientSecret: 'pi_test_secret',
      publishableKey: 'pk_test',
    })

    renderWithProvider(React.createElement(TopupForm, { amount: 1000 }), { createTopupPayment })

    await vi.waitFor(() => {
      expect(screen.getByTestId('stripe-elements')).toBeTruthy()
    })
  })

  it('does not call processPayment (verifies it is NOT called)', async () => {
    const processPayment = vi.fn()
    const createTopupPayment = vi.fn().mockResolvedValue({
      clientSecret: 'pi_test_secret',
      publishableKey: 'pk_test',
    })

    renderWithProvider(React.createElement(TopupForm, { amount: 1000 }), {
      processPayment,
      createTopupPayment,
    })

    await vi.waitFor(() => {
      expect(screen.getByTestId('stripe-elements')).toBeTruthy()
    })

    expect(processPayment).not.toHaveBeenCalled()
  })
})
