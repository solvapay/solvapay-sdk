import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { CancelledPlanNotice } from './CancelledPlanNotice'
import { SolvaPayContext } from '../SolvaPayProvider'
import type { PurchaseInfo, SolvaPayContextValue } from '../types'

const inFiveDays = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString()

const cancelledActivePurchase: PurchaseInfo = {
  reference: 'pur_456',
  productName: 'Widget API',
  status: 'active',
  startDate: new Date().toISOString(),
  endDate: inFiveDays,
  cancelledAt: new Date().toISOString(),
  cancellationReason: 'Too expensive',
  amount: 1999,
}

function buildCtx(purchases: PurchaseInfo[]): SolvaPayContextValue {
  return {
    purchase: {
      loading: false,
      isRefetching: false,
      error: null,
      purchases,
      hasProduct: () => false,
      hasPlan: () => false,
      activePurchase: purchases.find(p => p.status === 'active') ?? null,
      hasPaidPurchase: false,
      activePaidPurchase: null,
    },
    refetchPurchase: vi.fn(),
    createPayment: vi.fn(),
    createTopupPayment: vi.fn(),
    cancelRenewal: vi.fn(),
    reactivateRenewal: vi.fn(async () => ({ success: true } as never)),
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
  }
}

function Wrap({ ctx, children }: { ctx: SolvaPayContextValue; children: React.ReactNode }) {
  return <SolvaPayContext.Provider value={ctx}>{children}</SolvaPayContext.Provider>
}

describe('CancelledPlanNotice', () => {
  it('renders nothing when there is no cancelled purchase', () => {
    const { container } = render(
      <Wrap ctx={buildCtx([])}>
        <CancelledPlanNotice />
      </Wrap>,
    )
    expect(container.textContent?.trim() || '').toBe('')
  })

  it('renders heading, expiration, days remaining, and reason', () => {
    render(
      <Wrap ctx={buildCtx([cancelledActivePurchase])}>
        <CancelledPlanNotice />
      </Wrap>,
    )
    expect(screen.getByText('Your purchase has been cancelled')).toBeTruthy()
    expect(screen.getByText(/Purchase Expires:/)).toBeTruthy()
    expect(screen.getByText(/5 days remaining/)).toBeTruthy()
    expect(screen.getByText(/Too expensive/)).toBeTruthy()
  })

  it('reactivate button triggers reactivateRenewal and onReactivated', async () => {
    const ctx = buildCtx([cancelledActivePurchase])
    const onReactivated = vi.fn()
    render(
      <Wrap ctx={ctx}>
        <CancelledPlanNotice onReactivated={onReactivated} />
      </Wrap>,
    )
    fireEvent.click(screen.getByRole('button', { name: /Undo Cancellation/ }))
    await waitFor(() =>
      expect(ctx.reactivateRenewal).toHaveBeenCalledWith({ purchaseRef: 'pur_456' }),
    )
    await waitFor(() => expect(onReactivated).toHaveBeenCalled())
  })

  it('render-prop receives purchase + daysRemaining + reactivate', () => {
    render(
      <Wrap ctx={buildCtx([cancelledActivePurchase])}>
        <CancelledPlanNotice>
          {({ purchase, daysRemaining }) => (
            <div data-testid="custom">
              {purchase.reference} | days:{daysRemaining}
            </div>
          )}
        </CancelledPlanNotice>
      </Wrap>,
    )
    expect(screen.getByTestId('custom').textContent).toBe('pur_456 | days:5')
  })
})
