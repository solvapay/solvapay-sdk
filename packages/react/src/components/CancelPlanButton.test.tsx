import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import React, { createRef } from 'react'
import { CancelPlanButton } from './CancelPlanButton'
import { SolvaPayContext } from '../SolvaPayProvider'
import { MissingProviderError } from '../utils/errors'
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

function Wrap({ ctx, children }: { ctx: SolvaPayContextValue; children: React.ReactNode }) {
  return <SolvaPayContext.Provider value={ctx}>{children}</SolvaPayContext.Provider>
}

describe('CancelPlanButton', () => {
  it('renders default label and emits data-state=idle', () => {
    render(
      <Wrap ctx={buildCtx([recurringActivePurchase])}>
        <CancelPlanButton />
      </Wrap>,
    )
    const btn = screen.getByRole('button', { name: /Cancel plan/ })
    expect(btn.getAttribute('data-state')).toBe('idle')
    expect(btn.getAttribute('data-solvapay-cancel-plan')).toBe('')
  })

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
    expect(confirmSpy.mock.calls[0][0]).toMatch(/deactivate your plan/)
  })

  it('asChild swaps element shell and forwards handlers + data-state', async () => {
    const ctx = buildCtx([recurringActivePurchase])
    const consumerClick = vi.fn()
    const ref = createRef<HTMLButtonElement>()
    render(
      <Wrap ctx={ctx}>
        <CancelPlanButton asChild confirm={false}>
          <button ref={ref} className="from-consumer" onClick={consumerClick} data-testid="custom">
            End subscription
          </button>
        </CancelPlanButton>
      </Wrap>,
    )
    const btn = screen.getByTestId('custom')
    expect(btn.textContent).toBe('End subscription')
    expect(btn.getAttribute('data-state')).toBe('idle')
    expect(btn.className).toContain('from-consumer')
    expect(ref.current).toBe(btn)
    fireEvent.click(btn)
    await waitFor(() => expect(ctx.cancelRenewal).toHaveBeenCalled())
    expect(consumerClick).toHaveBeenCalled()
  })

  it('throws MissingProviderError when rendered outside SolvaPayProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<CancelPlanButton />)).toThrow(MissingProviderError)
    spy.mockRestore()
  })
})
