import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import React, { createRef } from 'react'
import { ProductBadge, PlanBadge } from './ProductBadge'
import { SolvaPayContext } from '../SolvaPayProvider'
import { MissingProviderError } from '../utils/errors'
import type { PurchaseInfo, SolvaPayContextValue } from '../types'

const activePurchase: PurchaseInfo = {
  reference: 'pur_1',
  productName: 'Widget API',
  status: 'active',
  startDate: new Date().toISOString(),
  amount: 1999,
}

function ctxWith(purchases: PurchaseInfo[]): SolvaPayContextValue {
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
  }
}

function Wrap({ ctx, children }: { ctx: SolvaPayContextValue; children: React.ReactNode }) {
  return <SolvaPayContext.Provider value={ctx}>{children}</SolvaPayContext.Provider>
}

describe('ProductBadge primitive', () => {
  it('renders product name + aria-label + data-has-purchase flags', () => {
    render(
      <Wrap ctx={ctxWith([activePurchase])}>
        <ProductBadge data-testid="badge" />
      </Wrap>,
    )
    const node = screen.getByTestId('badge')
    expect(node.textContent).toBe('Widget API')
    expect(node.getAttribute('data-has-purchase')).toBe('')
    expect(node.getAttribute('data-has-paid-purchase')).toBe('')
    expect(node.getAttribute('aria-label')).toBe('Current product: Widget API')
  })

  it('renders null when no active purchase exists', () => {
    const { container } = render(
      <Wrap ctx={ctxWith([])}>
        <ProductBadge data-testid="badge" />
      </Wrap>,
    )
    expect(container.textContent).toBe('')
  })

  it('asChild swaps element shell and forwards attrs + refs', () => {
    const ref = createRef<HTMLAnchorElement>()
    render(
      <Wrap ctx={ctxWith([activePurchase])}>
        <ProductBadge asChild data-testid="badge" className="from-primitive">
          <a ref={ref} href="/account" className="from-consumer">
            {'My product'}
          </a>
        </ProductBadge>
      </Wrap>,
    )
    const node = screen.getByTestId('badge')
    expect(node.tagName).toBe('A')
    expect(node.getAttribute('href')).toBe('/account')
    expect(node.className).toContain('from-primitive')
    expect(node.className).toContain('from-consumer')
    expect(ref.current).toBe(node)
  })

  it('PlanBadge is an alias for ProductBadge', () => {
    expect(PlanBadge).toBe(ProductBadge)
  })

  it('throws MissingProviderError when rendered outside SolvaPayProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<ProductBadge />)).toThrow(MissingProviderError)
    spy.mockRestore()
  })
})
