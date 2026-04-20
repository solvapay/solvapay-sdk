/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import React, { createRef } from 'react'
import { TopupForm, useTopupForm } from './TopupForm'
import { SolvaPayContext } from '../SolvaPayProvider'
import { MissingProviderError } from '../utils/errors'
import type { SolvaPayContextValue } from '../types'

vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'stripe-elements' }, children),
  useStripe: () => ({ confirmCardPayment: vi.fn(), confirmPayment: vi.fn() }),
  useElements: () => ({ getElement: vi.fn() }),
  CardElement: () => React.createElement('div', { 'data-testid': 'card-element' }),
  PaymentElement: () => React.createElement('div', { 'data-testid': 'payment-element' }),
}))

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(() => Promise.resolve({ confirmCardPayment: vi.fn() })),
}))

function ctx(overrides?: Partial<SolvaPayContextValue>): SolvaPayContextValue {
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
      creditsPerMinorUnit: null,
      displayExchangeRate: null,
      refetch: vi.fn(),
      adjustBalance: vi.fn(),
    },
    ...overrides,
  }
}

function Wrap({
  value,
  children,
}: {
  value: SolvaPayContextValue
  children: React.ReactNode
}) {
  return React.createElement(SolvaPayContext.Provider, { value }, children)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('TopupForm primitive', () => {
  it('renders children (SubmitButton disabled) during the pre-Elements load', () => {
    render(
      <Wrap value={ctx()}>
        <TopupForm.Root amount={1000} data-testid="root">
          <TopupForm.PaymentElement />
          <TopupForm.SubmitButton data-testid="submit" />
          <TopupForm.Loading data-testid="loading" />
        </TopupForm.Root>
      </Wrap>,
    )
    const btn = screen.getByTestId('submit')
    expect(btn).toBeDisabled()
    expect(btn.getAttribute('data-state')).toBe('disabled')
    expect(screen.getByTestId('loading')).toBeTruthy()
  })

  it('data-state=error when amount is not positive and Error renders', () => {
    render(
      <Wrap value={ctx()}>
        <TopupForm.Root amount={0} data-testid="root">
          <TopupForm.Error data-testid="error" />
          <TopupForm.SubmitButton />
        </TopupForm.Root>
      </Wrap>,
    )
    const root = screen.getByTestId('root')
    expect(root.getAttribute('data-state')).toBe('error')
    expect(screen.getByTestId('error').textContent).toMatch(/amount must be a positive number/i)
  })

  it('useTopupForm hook exposes state + amount for custom leaves', () => {
    const Probe = () => {
      const { amount, state } = useTopupForm()
      return (
        <span data-testid="probe">
          {state}:{amount}
        </span>
      )
    }
    render(
      <Wrap value={ctx()}>
        <TopupForm.Root amount={1000}>
          <Probe />
        </TopupForm.Root>
      </Wrap>,
    )
    expect(screen.getByTestId('probe').textContent).toBe('loading:1000')
  })

  it('asChild swaps Root shell and merges refs', () => {
    const ref = createRef<HTMLDivElement>()
    render(
      <Wrap value={ctx()}>
        <TopupForm.Root asChild amount={1000} data-testid="root">
          <section
            ref={ref as unknown as React.Ref<HTMLDivElement>}
            className="from-consumer"
          >
            <TopupForm.SubmitButton />
          </section>
        </TopupForm.Root>
      </Wrap>,
    )
    const root = screen.getByTestId('root')
    expect(root.tagName).toBe('SECTION')
    expect(root.className).toContain('from-consumer')
    expect(ref.current).toBe(root)
  })

  it('throws MissingProviderError when rendered outside SolvaPayProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      render(
        <TopupForm.Root amount={1000}>
          <TopupForm.SubmitButton />
        </TopupForm.Root>,
      ),
    ).toThrow(MissingProviderError)
    spy.mockRestore()
  })
})
