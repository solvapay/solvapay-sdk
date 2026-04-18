import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import React, { createRef } from 'react'
import { PurchaseGate, usePurchaseGate } from './PurchaseGate'
import { SolvaPayContext } from '../SolvaPayProvider'
import { MissingProviderError } from '../utils/errors'
import type { PurchaseInfo, SolvaPayContextValue } from '../types'

function ctxWith(
  purchases: PurchaseInfo[],
  loading = false,
): SolvaPayContextValue {
  const hasPurchase = (criteria?: { productRef?: string; planRef?: string }) => {
    const productRef = criteria?.productRef
    const planRef = criteria?.planRef
    return purchases.some(
      p =>
        p.status === 'active' &&
        (!productRef || p.productRef === productRef) &&
        (!planRef || p.planRef === planRef),
    )
  }
  return {
    purchase: {
      loading,
      isRefetching: false,
      error: null,
      purchases,
      hasPurchase,
      activePurchase: purchases.find(p => p.status === 'active') ?? null,
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

const active: PurchaseInfo = {
  reference: 'pur_1',
  productName: 'Widget API',
  productRef: 'prd_widget',
  planRef: 'pln_monthly',
  status: 'active',
  startDate: new Date().toISOString(),
}

describe('PurchaseGate primitive', () => {
  it('emits data-state=allowed when productRef matches and renders Allowed', () => {
    render(
      <Wrap ctx={ctxWith([active])}>
        <PurchaseGate.Root productRef="prd_widget" data-testid="root">
          <PurchaseGate.Allowed data-testid="allowed">unlocked</PurchaseGate.Allowed>
          <PurchaseGate.Blocked data-testid="blocked">paywall</PurchaseGate.Blocked>
        </PurchaseGate.Root>
      </Wrap>,
    )
    expect(screen.getByTestId('root').getAttribute('data-state')).toBe('allowed')
    expect(screen.getByTestId('allowed').textContent).toBe('unlocked')
    expect(screen.queryByTestId('blocked')).toBeNull()
  })

  it('emits data-state=blocked when productRef does not match', () => {
    render(
      <Wrap ctx={ctxWith([active])}>
        <PurchaseGate.Root productRef="prd_other" data-testid="root">
          <PurchaseGate.Allowed data-testid="allowed">unlocked</PurchaseGate.Allowed>
          <PurchaseGate.Blocked data-testid="blocked">paywall</PurchaseGate.Blocked>
        </PurchaseGate.Root>
      </Wrap>,
    )
    expect(screen.getByTestId('root').getAttribute('data-state')).toBe('blocked')
    expect(screen.getByTestId('blocked').textContent).toBe('paywall')
    expect(screen.queryByTestId('allowed')).toBeNull()
  })

  it('emits data-state=allowed when planRef matches', () => {
    render(
      <Wrap ctx={ctxWith([active])}>
        <PurchaseGate.Root planRef="pln_monthly" data-testid="root">
          <PurchaseGate.Allowed data-testid="allowed">unlocked</PurchaseGate.Allowed>
          <PurchaseGate.Blocked data-testid="blocked">paywall</PurchaseGate.Blocked>
        </PurchaseGate.Root>
      </Wrap>,
    )
    expect(screen.getByTestId('root').getAttribute('data-state')).toBe('allowed')
    expect(screen.getByTestId('allowed').textContent).toBe('unlocked')
  })

  it('emits data-state=blocked when planRef does not match', () => {
    render(
      <Wrap ctx={ctxWith([active])}>
        <PurchaseGate.Root planRef="pln_yearly" data-testid="root">
          <PurchaseGate.Allowed data-testid="allowed">unlocked</PurchaseGate.Allowed>
          <PurchaseGate.Blocked data-testid="blocked">paywall</PurchaseGate.Blocked>
        </PurchaseGate.Root>
      </Wrap>,
    )
    expect(screen.getByTestId('root').getAttribute('data-state')).toBe('blocked')
    expect(screen.getByTestId('blocked').textContent).toBe('paywall')
  })

  it('emits data-state=allowed when productRef and planRef both match the same purchase', () => {
    render(
      <Wrap ctx={ctxWith([active])}>
        <PurchaseGate.Root productRef="prd_widget" planRef="pln_monthly" data-testid="root">
          <PurchaseGate.Allowed data-testid="allowed">unlocked</PurchaseGate.Allowed>
          <PurchaseGate.Blocked data-testid="blocked">paywall</PurchaseGate.Blocked>
        </PurchaseGate.Root>
      </Wrap>,
    )
    expect(screen.getByTestId('root').getAttribute('data-state')).toBe('allowed')
    expect(screen.getByTestId('allowed').textContent).toBe('unlocked')
  })

  it('emits data-state=blocked when productRef matches but planRef is a different plan under the same product', () => {
    render(
      <Wrap ctx={ctxWith([active])}>
        <PurchaseGate.Root productRef="prd_widget" planRef="pln_yearly" data-testid="root">
          <PurchaseGate.Allowed data-testid="allowed">unlocked</PurchaseGate.Allowed>
          <PurchaseGate.Blocked data-testid="blocked">paywall</PurchaseGate.Blocked>
        </PurchaseGate.Root>
      </Wrap>,
    )
    expect(screen.getByTestId('root').getAttribute('data-state')).toBe('blocked')
    expect(screen.getByTestId('blocked').textContent).toBe('paywall')
  })

  it('requires productRef and planRef to match on the same purchase (AND, not OR across purchases)', () => {
    const widgetYearly: PurchaseInfo = {
      reference: 'pur_2',
      productName: 'Widget API',
      productRef: 'prd_widget',
      planRef: 'pln_yearly',
      status: 'active',
      startDate: new Date().toISOString(),
    }
    const gadgetMonthly: PurchaseInfo = {
      reference: 'pur_3',
      productName: 'Gadget',
      productRef: 'prd_gadget',
      planRef: 'pln_monthly',
      status: 'active',
      startDate: new Date().toISOString(),
    }
    render(
      <Wrap ctx={ctxWith([widgetYearly, gadgetMonthly])}>
        <PurchaseGate.Root productRef="prd_widget" planRef="pln_monthly" data-testid="root">
          <PurchaseGate.Allowed data-testid="allowed">unlocked</PurchaseGate.Allowed>
          <PurchaseGate.Blocked data-testid="blocked">paywall</PurchaseGate.Blocked>
        </PurchaseGate.Root>
      </Wrap>,
    )
    expect(screen.getByTestId('root').getAttribute('data-state')).toBe('blocked')
  })

  it('allows any active purchase when no productRef or planRef is set', () => {
    render(
      <Wrap ctx={ctxWith([active])}>
        <PurchaseGate.Root data-testid="root">
          <PurchaseGate.Allowed data-testid="allowed">unlocked</PurchaseGate.Allowed>
          <PurchaseGate.Blocked data-testid="blocked">paywall</PurchaseGate.Blocked>
        </PurchaseGate.Root>
      </Wrap>,
    )
    expect(screen.getByTestId('root').getAttribute('data-state')).toBe('allowed')
  })

  it('emits data-state=loading when purchase data is loading', () => {
    render(
      <Wrap ctx={ctxWith([], true)}>
        <PurchaseGate.Root data-testid="root">
          <PurchaseGate.Loading data-testid="loading">loading</PurchaseGate.Loading>
        </PurchaseGate.Root>
      </Wrap>,
    )
    expect(screen.getByTestId('root').getAttribute('data-state')).toBe('loading')
    expect(screen.getByTestId('loading').textContent).toBe('loading')
  })

  it('asChild swaps Root element shell and forwards refs', () => {
    const ref = createRef<HTMLDivElement>()
    render(
      <Wrap ctx={ctxWith([active])}>
        <PurchaseGate.Root asChild productRef="prd_widget" data-testid="root">
          <section ref={ref as unknown as React.Ref<HTMLDivElement>} className="from-consumer">
            <PurchaseGate.Allowed>gated</PurchaseGate.Allowed>
          </section>
        </PurchaseGate.Root>
      </Wrap>,
    )
    const root = screen.getByTestId('root')
    expect(root.tagName).toBe('SECTION')
    expect(root.className).toContain('from-consumer')
    expect(ref.current).toBe(root)
  })

  it('usePurchaseGate hook exposes state for custom leaves', () => {
    const Probe = () => {
      const { state, hasAccess } = usePurchaseGate()
      return (
        <span data-testid="probe">
          {state}:{String(hasAccess)}
        </span>
      )
    }
    render(
      <Wrap ctx={ctxWith([active])}>
        <PurchaseGate.Root productRef="prd_widget">
          <Probe />
        </PurchaseGate.Root>
      </Wrap>,
    )
    expect(screen.getByTestId('probe').textContent).toBe('allowed:true')
  })

  it('throws MissingProviderError when rendered outside SolvaPayProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      render(
        <PurchaseGate.Root>
          <PurchaseGate.Allowed>ok</PurchaseGate.Allowed>
        </PurchaseGate.Root>,
      ),
    ).toThrow(MissingProviderError)
    spy.mockRestore()
  })
})
