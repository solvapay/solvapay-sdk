import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import React, { createRef } from 'react'
import { BalanceBadge } from './BalanceBadge'
import { SolvaPayContext } from '../SolvaPayProvider'
import { MissingProviderError } from '../utils/errors'
import type { BalanceStatus, SolvaPayContextValue } from '../types'

function ctxWith(overrides: Partial<BalanceStatus> = {}): SolvaPayContextValue {
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

function Wrap({ ctx, children }: { ctx: SolvaPayContextValue; children: React.ReactNode }) {
  return <SolvaPayContext.Provider value={ctx}>{children}</SolvaPayContext.Provider>
}

describe('BalanceBadge primitive', () => {
  it('renders credits + currency equivalent + data-state=ok for a healthy balance', () => {
    render(
      <Wrap ctx={ctxWith({ credits: 500 })}>
        <BalanceBadge data-testid="badge" />
      </Wrap>,
    )
    const badge = screen.getByTestId('badge')
    expect(badge.getAttribute('data-state')).toBe('ok')
    expect(badge.textContent).toContain('500')
    expect(badge.textContent).toContain('credits')
  })

  it('emits data-state=zero when balance is 0', () => {
    render(
      <Wrap ctx={ctxWith({ credits: 0 })}>
        <BalanceBadge data-testid="badge" />
      </Wrap>,
    )
    // credits === 0 → state=zero, and the primitive returns null from the body.
    // The empty-span placeholder renders when loading. For zero, credits != null,
    // so the badge still renders credits + state=zero.
    const badge = screen.getByTestId('badge')
    expect(badge.getAttribute('data-state')).toBe('zero')
  })

  it('emits data-state=low when credits are below lowThreshold', () => {
    render(
      <Wrap ctx={ctxWith({ credits: 5 })}>
        <BalanceBadge data-testid="badge" lowThreshold={10} />
      </Wrap>,
    )
    expect(screen.getByTestId('badge').getAttribute('data-state')).toBe('low')
  })

  it('emits data-state=loading and renders empty placeholder during fetch', () => {
    render(
      <Wrap ctx={ctxWith({ loading: true, credits: null })}>
        <BalanceBadge data-testid="badge" />
      </Wrap>,
    )
    const badge = screen.getByTestId('badge')
    expect(badge.getAttribute('data-state')).toBe('loading')
    expect(badge.getAttribute('aria-busy')).toBe('true')
  })

  it('asChild swaps the element shell and forwards data-state + refs', () => {
    const ref = createRef<HTMLSpanElement>()
    render(
      <Wrap ctx={ctxWith({ credits: 500 })}>
        <BalanceBadge asChild data-testid="badge" className="from-primitive">
          <span ref={ref} className="from-consumer" />
        </BalanceBadge>
      </Wrap>,
    )
    const badge = screen.getByTestId('badge')
    expect(badge.getAttribute('data-state')).toBe('ok')
    expect(badge.className).toContain('from-primitive')
    expect(badge.className).toContain('from-consumer')
    expect(ref.current).toBe(badge)
  })

  it('numberOnly renders credit number only (no " credits" / currency suffix)', () => {
    render(
      <Wrap ctx={ctxWith({ credits: 500 })}>
        <BalanceBadge data-testid="badge" numberOnly />
      </Wrap>,
    )
    expect(screen.getByTestId('badge').textContent).toBe('500')
  })

  it('throws MissingProviderError when rendered outside SolvaPayProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<BalanceBadge />)).toThrow(MissingProviderError)
    spy.mockRestore()
  })
})
