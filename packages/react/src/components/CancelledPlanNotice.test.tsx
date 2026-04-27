import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { CancelledPlanNotice as ShimCancelledPlanNotice } from './CancelledPlanNotice'
import {
  CancelledPlanNotice,
  useCancelledPlanNotice,
} from '../primitives/CancelledPlanNotice'
import { SolvaPayContext } from '../SolvaPayProvider'
import { MissingProviderError } from '../utils/errors'
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
  planSnapshot: { reference: 'pln_widget', planType: 'recurring' },
}

function buildCtx(purchases: PurchaseInfo[]): SolvaPayContextValue {
  return {
    purchase: {
      loading: false,
      isRefetching: false,
      error: null,
      purchases,
      hasProduct: () => false,
      activePurchase: purchases.find(p => p.status === 'active') ?? null,
      hasPaidPurchase: false,
      activePaidPurchase: null,
      balanceTransactions: [],
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

describe('CancelledPlanNotice (default-tree shim)', () => {
  it('renders nothing when there is no cancelled purchase', () => {
    const { container } = render(
      <Wrap ctx={buildCtx([])}>
        <ShimCancelledPlanNotice />
      </Wrap>,
    )
    expect(container.textContent?.trim() || '').toBe('')
  })

  it('renders heading, expiration, days remaining, and reason', () => {
    render(
      <Wrap ctx={buildCtx([cancelledActivePurchase])}>
        <ShimCancelledPlanNotice />
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
        <ShimCancelledPlanNotice onReactivated={onReactivated} />
      </Wrap>,
    )
    fireEvent.click(screen.getByRole('button', { name: /Undo Cancellation/ }))
    await waitFor(() =>
      expect(ctx.reactivateRenewal).toHaveBeenCalledWith({ purchaseRef: 'pur_456' }),
    )
    await waitFor(() => expect(onReactivated).toHaveBeenCalled())
  })
})

describe('CancelledPlanNotice primitive', () => {
  it('emits data-state=active + data-has-reason flags', () => {
    render(
      <Wrap ctx={buildCtx([cancelledActivePurchase])}>
        <CancelledPlanNotice.Root data-testid="root" />
      </Wrap>,
    )
    const root = screen.getByTestId('root')
    expect(root.getAttribute('data-state')).toBe('active')
    expect(root.getAttribute('data-has-reason')).toBe('')
  })

  it('useCancelledPlanNotice exposes state + reactivate', async () => {
    const ctx = buildCtx([cancelledActivePurchase])
    const Custom = () => {
      const { purchase, daysRemaining, reactivate } = useCancelledPlanNotice()
      return (
        <button onClick={() => void reactivate()} data-testid="custom">
          {purchase.reference}|days:{daysRemaining}
        </button>
      )
    }
    render(
      <Wrap ctx={ctx}>
        <CancelledPlanNotice.Root>
          <Custom />
        </CancelledPlanNotice.Root>
      </Wrap>,
    )
    const custom = screen.getByTestId('custom')
    expect(custom.textContent).toBe('pur_456|days:5')
    fireEvent.click(custom)
    await waitFor(() => expect(ctx.reactivateRenewal).toHaveBeenCalled())
  })

  it('throws MissingProviderError when rendered outside SolvaPayProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<CancelledPlanNotice.Root />)).toThrow(MissingProviderError)
    spy.mockRestore()
  })
})
