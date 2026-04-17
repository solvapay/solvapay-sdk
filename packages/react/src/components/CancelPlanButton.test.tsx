import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import React from 'react'
import { CancelPlanButton } from './CancelPlanButton'
import { SolvaPayContext } from '../SolvaPayProvider'
import type { PurchaseInfo, SolvaPayContextValue } from '../types'

beforeEach(() => {
  vi.stubGlobal('confirm', vi.fn(() => true))
})

function buildCtx(
  purchases: PurchaseInfo[],
  overrides: Partial<SolvaPayContextValue> = {},
): SolvaPayContextValue {
  const active = purchases.find(p => p.status === 'active') ?? null
  return {
    purchase: {
      loading: false,
      isRefetching: false,
      error: null,
      purchases,
      hasProduct: () => false,
      hasPlan: () => false,
      activePurchase: active,
      hasPaidPurchase: !!active && (active.amount ?? 0) > 0,
      activePaidPurchase: active,
    },
    refetchPurchase: vi.fn(),
    createPayment: vi.fn(),
    createTopupPayment: vi.fn(),
    cancelRenewal: vi.fn(async () => ({ success: true } as never)),
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

const recurringActivePurchase: PurchaseInfo = {
  reference: 'pur_123',
  productName: 'Widget API',
  status: 'active',
  startDate: new Date().toISOString(),
  planSnapshot: { reference: 'pln_monthly', planType: 'recurring' },
  amount: 1999,
}

const usagePurchase: PurchaseInfo = {
  ...recurringActivePurchase,
  planSnapshot: { reference: 'pln_usage', planType: 'usage-based' },
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

describe('CancelPlanButton', () => {
  it('auto-reads active purchase and calls cancelRenewal on confirm', async () => {
    const ctx = buildCtx([recurringActivePurchase])
    const onCancelled = vi.fn()
    render(
      <Wrap ctx={ctx}>
        <CancelPlanButton onCancelled={onCancelled} />
      </Wrap>,
    )
    fireEvent.click(screen.getByRole('button', { name: /Cancel plan/ }))
    await waitFor(() =>
      expect(ctx.cancelRenewal).toHaveBeenCalledWith({
        purchaseRef: 'pur_123',
        reason: undefined,
      }),
    )
    await waitFor(() => expect(onCancelled).toHaveBeenCalled())
  })

  it('confirm={false} skips the dialog', async () => {
    const confirmSpy = vi.fn()
    vi.stubGlobal('confirm', confirmSpy)
    const ctx = buildCtx([recurringActivePurchase])
    render(
      <Wrap ctx={ctx}>
        <CancelPlanButton confirm={false} />
      </Wrap>,
    )
    fireEvent.click(screen.getByRole('button', { name: /Cancel plan/ }))
    await waitFor(() => expect(ctx.cancelRenewal).toHaveBeenCalled())
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('uses usage-based confirm copy for usage-based plans', () => {
    const confirmSpy = vi.fn((_msg: string) => false)
    vi.stubGlobal('confirm', confirmSpy)
    const ctx = buildCtx([usagePurchase])
    render(
      <Wrap ctx={ctx}>
        <CancelPlanButton />
      </Wrap>,
    )
    fireEvent.click(screen.getByRole('button', { name: /Cancel plan/ }))
    expect(confirmSpy).toHaveBeenCalled()
    const args = confirmSpy.mock.calls[0]
    expect(args[0]).toMatch(/deactivate your plan/)
  })

  it('render-prop children receive cancel + isCancelling + purchase', () => {
    const ctx = buildCtx([recurringActivePurchase])
    render(
      <Wrap ctx={ctx}>
        <CancelPlanButton>
          {({ isCancelling, purchase }) => (
            <span data-testid="custom">
              custom-{purchase?.reference ?? 'none'}-{String(isCancelling)}
            </span>
          )}
        </CancelPlanButton>
      </Wrap>,
    )
    expect(screen.getByTestId('custom').textContent).toBe('custom-pur_123-false')
  })
})
