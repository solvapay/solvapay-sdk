import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { CreditGate } from './CreditGate'
import { SolvaPayContext } from '../SolvaPayProvider'
import type { BalanceStatus, SolvaPayContextValue } from '../types'

function ctxWithBalance(overrides?: Partial<BalanceStatus>): SolvaPayContextValue {
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
    createTopupPayment: vi.fn(),
    cancelRenewal: vi.fn(),
    reactivateRenewal: vi.fn(),
    activatePlan: vi.fn(),
    balance: {
      loading: false,
      credits: 500,
      displayCurrency: 'USD',
      creditsPerMinorUnit: 100,
      displayExchangeRate: 1,
      refetch: vi.fn(),
      adjustBalance: vi.fn(),
      ...overrides,
    },
  }
}

function Wrap({
  ctx,
  children,
}: {
  ctx: SolvaPayContextValue
  children: React.ReactNode
}) {
  return <SolvaPayContext.Provider value={ctx}>{children}</SolvaPayContext.Provider>
}

describe('CreditGate', () => {
  it('renders children when balance meets threshold', async () => {
    render(
      <Wrap ctx={ctxWithBalance({ credits: 500 })}>
        <CreditGate minCredits={10}>
          <div data-testid="unlocked">unlocked</div>
        </CreditGate>
      </Wrap>,
    )
    await waitFor(() => expect(screen.getByTestId('unlocked')).toBeTruthy())
  })

  it('shows default fallback when balance is below threshold', () => {
    render(
      <Wrap ctx={ctxWithBalance({ credits: 5 })}>
        <CreditGate minCredits={10}>
          <div data-testid="unlocked">unlocked</div>
        </CreditGate>
      </Wrap>,
    )
    expect(screen.getByText(/out of credits/i)).toBeTruthy()
    expect(screen.queryByTestId('unlocked')).toBeNull()
  })

  it('honours the fallback prop', () => {
    render(
      <Wrap ctx={ctxWithBalance({ credits: 0 })}>
        <CreditGate fallback={<div data-testid="custom-fallback">buy more</div>}>
          <div>unlocked</div>
        </CreditGate>
      </Wrap>,
    )
    expect(screen.getByTestId('custom-fallback')).toBeTruthy()
  })

  it('render-prop receives balance + hasCredits', () => {
    render(
      <Wrap ctx={ctxWithBalance({ credits: 3 })}>
        <CreditGate minCredits={5}>
          {({ balance, hasCredits }) => (
            <div data-testid="rp">
              b={balance ?? 'null'} / hasCredits={String(hasCredits)}
            </div>
          )}
        </CreditGate>
      </Wrap>,
    )
    expect(screen.getByTestId('rp').textContent).toBe('b=3 / hasCredits=false')
  })
})
