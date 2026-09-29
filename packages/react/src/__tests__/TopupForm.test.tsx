/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { TopupForm } from '../TopupForm'
import { SolvaPayContext } from '../SolvaPayProvider'
import type { SolvaPayContextValue } from '../types'
import { mockBalanceStatus } from '../test-helpers/mockBalanceStatus'

vi.mock('../vault/CardFields', () => ({
  VaultCardFields: (props: { vault: unknown; paymentIntentId: string | null }) =>
    props.vault && props.paymentIntentId
      ? React.createElement('div', {
          'data-testid': 'card-fields',
          'data-payment-intent': props.paymentIntentId,
        })
      : null,
}))

const vaultIntent = {
  id: 'pi_topup_1',
  captureMode: 'vault' as const,
  vault: { tenantId: 'tntr4ol0cbq', environment: 'sandbox' as const },
}

function createMockContext(overrides?: Partial<SolvaPayContextValue>): SolvaPayContextValue {
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
    upsertPurchase: vi.fn(),
    createPayment: vi.fn(),
    createTopupPayment: vi.fn().mockResolvedValue(vaultIntent),
    createCaptureGrant: vi.fn(),
    confirmPayment: vi.fn(),
    cancelRenewal: vi.fn(),
    reactivateRenewal: vi.fn(),
    activatePlan: vi.fn(),
    balance: mockBalanceStatus(),
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
    const createTopupPayment = vi.fn().mockResolvedValue(vaultIntent)
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

  it('renders the vault card fields once the payment intent exists', async () => {
    const createTopupPayment = vi.fn().mockResolvedValue(vaultIntent)

    renderWithProvider(React.createElement(TopupForm, { amount: 1000 }), { createTopupPayment })

    await vi.waitFor(() => {
      expect(screen.getByTestId('card-fields')).toHaveAttribute('data-payment-intent', 'pi_topup_1')
    })
  })

  it('does not call processPayment (verifies it is NOT called)', async () => {
    const processPayment = vi.fn()
    const createTopupPayment = vi.fn().mockResolvedValue(vaultIntent)

    renderWithProvider(React.createElement(TopupForm, { amount: 1000 }), {
      processPayment,
      createTopupPayment,
    })

    await vi.waitFor(() => {
      expect(screen.getByTestId('card-fields')).toHaveAttribute('data-payment-intent', 'pi_topup_1')
    })

    expect(processPayment).not.toHaveBeenCalled()
  })
})
