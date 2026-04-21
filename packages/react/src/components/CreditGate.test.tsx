import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import React, { createRef } from 'react'
import { CreditGate as ShimCreditGate } from './CreditGate'
import {
  CreditGate,
  useCreditGate,
} from '../primitives/CreditGate'
import { SolvaPayContext } from '../SolvaPayProvider'
import { MissingProviderError } from '../utils/errors'
import type { BalanceStatus, SolvaPayContextValue } from '../types'

function ctxWithBalance(overrides?: Partial<BalanceStatus>): SolvaPayContextValue {
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

function Wrap({ ctx, children }: { ctx: SolvaPayContextValue; children: React.ReactNode }) {
  return <SolvaPayContext.Provider value={ctx}>{children}</SolvaPayContext.Provider>
}

describe('CreditGate (default-tree shim)', () => {
  it('renders children when balance meets threshold', async () => {
    render(
      <Wrap ctx={ctxWithBalance({ credits: 500 })}>
        <ShimCreditGate minCredits={10}>
          <div data-testid="unlocked">unlocked</div>
        </ShimCreditGate>
      </Wrap>,
    )
    await waitFor(() => expect(screen.getByTestId('unlocked')).toBeTruthy())
  })

  it('renders default blocked tree (low balance copy + topup) when below threshold', () => {
    render(
      <Wrap ctx={ctxWithBalance({ credits: 5 })}>
        <ShimCreditGate minCredits={10}>
          <div data-testid="unlocked">unlocked</div>
        </ShimCreditGate>
      </Wrap>,
    )
    expect(screen.getByText(/out of credits/i)).toBeTruthy()
    expect(screen.queryByTestId('unlocked')).toBeNull()
  })

  it('honours the fallback prop when blocked', () => {
    render(
      <Wrap ctx={ctxWithBalance({ credits: 0 })}>
        <ShimCreditGate fallback={<div data-testid="custom-fallback">buy more</div>}>
          <div>unlocked</div>
        </ShimCreditGate>
      </Wrap>,
    )
    expect(screen.getByTestId('custom-fallback')).toBeTruthy()
  })
})

describe('CreditGate primitive', () => {
  it('emits data-state=allowed/blocked and gates subcomponents by state', () => {
    const { rerender } = render(
      <Wrap ctx={ctxWithBalance({ credits: 50 })}>
        <CreditGate.Root minCredits={10} data-testid="root">
          <CreditGate.Heading data-testid="heading" />
          <CreditGate.Subheading data-testid="subheading" />
        </CreditGate.Root>
      </Wrap>,
    )
    expect(screen.getByTestId('root').getAttribute('data-state')).toBe('allowed')
    expect(screen.queryByTestId('heading')).toBeNull()
    expect(screen.queryByTestId('subheading')).toBeNull()

    rerender(
      <Wrap ctx={ctxWithBalance({ credits: 1 })}>
        <CreditGate.Root minCredits={10} data-testid="root">
          <CreditGate.Heading data-testid="heading" />
          <CreditGate.Subheading data-testid="subheading" />
        </CreditGate.Root>
      </Wrap>,
    )
    expect(screen.getByTestId('root').getAttribute('data-state')).toBe('blocked')
    expect(screen.getByTestId('heading')).toBeTruthy()
    expect(screen.getByTestId('subheading')).toBeTruthy()
  })

  it('asChild on Heading swaps element shell and merges refs/classes', () => {
    const ref = createRef<HTMLHeadingElement>()
    render(
      <Wrap ctx={ctxWithBalance({ credits: 0 })}>
        <CreditGate.Root minCredits={10}>
          <CreditGate.Heading asChild data-testid="heading" className="from-primitive">
            <h2 ref={ref} className="from-consumer">
              Custom heading
            </h2>
          </CreditGate.Heading>
        </CreditGate.Root>
      </Wrap>,
    )
    const node = screen.getByTestId('heading')
    expect(node.tagName).toBe('H2')
    expect(node.textContent).toBe('Custom heading')
    expect(node.className).toContain('from-primitive')
    expect(node.className).toContain('from-consumer')
    expect(ref.current).toBe(node)
  })

  it('useCreditGate hook exposes state + balance for custom leaves', () => {
    const Custom = () => {
      const ctx = useCreditGate()
      return <span data-testid="custom">{ctx.state}:{ctx.balance}</span>
    }
    render(
      <Wrap ctx={ctxWithBalance({ credits: 3 })}>
        <CreditGate.Root minCredits={5}>
          <Custom />
        </CreditGate.Root>
      </Wrap>,
    )
    expect(screen.getByTestId('custom').textContent).toBe('blocked:3')
  })

  it('throws MissingProviderError when rendered outside SolvaPayProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      render(
        <CreditGate.Root>
          <CreditGate.Heading />
        </CreditGate.Root>,
      ),
    ).toThrow(MissingProviderError)
    spy.mockRestore()
  })
})
