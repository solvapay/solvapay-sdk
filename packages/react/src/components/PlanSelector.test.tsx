import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import React, { createRef } from 'react'
import { PlanSelector as ShimPlanSelector } from './PlanSelector'
import { CheckoutSummary as ShimCheckoutSummary } from './CheckoutSummary'
import { PlanSelector } from '../primitives/PlanSelector'
import { SolvaPayProvider } from '../SolvaPayProvider'
import { plansCache } from '../hooks/usePlans'
import { productCache } from '../hooks/useProduct'
import { MissingProductRefError, MissingProviderError } from '../utils/errors'
import type { Plan } from '../types'

const monthly: Plan = {
  reference: 'pln_monthly',
  name: 'Monthly',
  price: 1999,
  currency: 'usd',
  type: 'recurring',
  interval: 'month',
}
const yearly: Plan = {
  reference: 'pln_yearly',
  name: 'Yearly',
  price: 19900,
  currency: 'usd',
  type: 'recurring',
  interval: 'year',
  trialDays: 7,
}
const free: Plan = {
  reference: 'pln_free',
  name: 'Starter',
  price: 0,
  currency: 'usd',
  type: 'recurring',
  interval: 'month',
  requiresPayment: false,
}

function seed(plans: Plan[]) {
  plansCache.set('prd_x', { plans, timestamp: Date.now(), promise: null })
  productCache.set('prd_x', {
    product: { reference: 'prd_x', name: 'Widget API' },
    promise: null,
    timestamp: Date.now(),
  })
}

beforeEach(() => {
  plansCache.clear()
  productCache.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PlanSelector (default-tree shim)', () => {
  it('renders heading + card grid with formatted prices', async () => {
    seed([monthly, yearly])
    render(
      <SolvaPayProvider config={{}}>
        <ShimPlanSelector productRef="prd_x" />
      </SolvaPayProvider>,
    )
    await waitFor(() => expect(screen.getByText('Choose your pricing')).toBeTruthy())
    expect(screen.getByText('Monthly')).toBeTruthy()
    expect(screen.getByText('Yearly')).toBeTruthy()
    expect(screen.getByText('$19.99')).toBeTruthy()
    expect(screen.getByText('$199')).toBeTruthy()
    expect(screen.getByText('/month')).toBeTruthy()
  })

  it('calls onSelect and flips data-state=selected when a plan card is clicked', async () => {
    seed([monthly, yearly])
    const onSelect = vi.fn()
    render(
      <SolvaPayProvider config={{}}>
        <ShimPlanSelector productRef="prd_x" onSelect={onSelect} />
      </SolvaPayProvider>,
    )
    const yearlyCard = (await screen.findByText('Yearly')).closest('button') as HTMLButtonElement
    fireEvent.click(yearlyCard)
    expect(onSelect).toHaveBeenCalledWith(
      'pln_yearly',
      expect.objectContaining({ reference: 'pln_yearly' }),
    )
    await waitFor(() => expect(yearlyCard.getAttribute('data-state')).toBe('selected'))
  })

  it('marks free plans with data-state=disabled + data-free and blocks selection', async () => {
    seed([monthly, free])
    const onSelect = vi.fn()
    render(
      <SolvaPayProvider config={{}}>
        <ShimPlanSelector productRef="prd_x" onSelect={onSelect} />
      </SolvaPayProvider>,
    )
    const freeCard = (await screen.findByText('Starter')).closest('button') as HTMLButtonElement
    expect(freeCard.disabled).toBe(true)
    expect(freeCard.getAttribute('data-state')).toBe('disabled')
    expect(freeCard.getAttribute('data-free')).toBe('')
    fireEvent.click(freeCard)
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getByText('Free')).toBeTruthy()
  })

  it('marks currentPlanRef with data-state=current and renders the current badge', async () => {
    seed([monthly, yearly])
    render(
      <SolvaPayProvider config={{}}>
        <ShimPlanSelector productRef="prd_x" currentPlanRef="pln_monthly" />
      </SolvaPayProvider>,
    )
    const currentCard = (await screen.findByText('Monthly')).closest('button') as HTMLButtonElement
    expect(currentCard.getAttribute('data-state')).toBe('current')
    expect(currentCard.disabled).toBe(true)
    const badge = screen.getByText('Current')
    expect(badge.getAttribute('data-variant')).toBe('current')
  })

  it('renders the Popular badge with data-variant=popular on popularPlanRef', async () => {
    seed([monthly, yearly])
    render(
      <SolvaPayProvider config={{}}>
        <ShimPlanSelector productRef="prd_x" popularPlanRef="pln_yearly" />
      </SolvaPayProvider>,
    )
    const badge = await screen.findByText('Popular')
    expect(badge.getAttribute('data-variant')).toBe('popular')
  })

  it('shares selected plan via PlanSelectionContext to nested CheckoutSummary', async () => {
    seed([monthly, yearly])
    render(
      <SolvaPayProvider config={{}}>
        <ShimPlanSelector productRef="prd_x" initialPlanRef="pln_yearly">
          <ShimCheckoutSummary />
        </ShimPlanSelector>
      </SolvaPayProvider>,
    )
    await waitFor(() => expect(screen.getByText('$199 / year')).toBeTruthy())
  })
})

describe('PlanSelector primitive', () => {
  it('default render: subcomponents emit opaque selectors and data-state', async () => {
    seed([monthly, yearly])
    render(
      <SolvaPayProvider config={{}}>
        <PlanSelector.Root productRef="prd_x" data-testid="root">
          <PlanSelector.Heading data-testid="heading">Pick one</PlanSelector.Heading>
          <PlanSelector.Grid data-testid="grid">
            <PlanSelector.Card>
              <PlanSelector.CardName />
              <PlanSelector.CardPrice />
              <PlanSelector.CardInterval />
            </PlanSelector.Card>
          </PlanSelector.Grid>
        </PlanSelector.Root>
      </SolvaPayProvider>,
    )
    await waitFor(() => expect(screen.getByText('Monthly')).toBeTruthy())
    expect(screen.getByTestId('root').getAttribute('data-solvapay-plan-selector')).toBe('')
    expect(screen.getByTestId('heading').getAttribute('data-solvapay-plan-selector-heading')).toBe('')
    expect(screen.getByTestId('grid').getAttribute('data-solvapay-plan-selector-grid')).toBe('')
    const monthlyCard = screen.getByText('Monthly').closest('button') as HTMLButtonElement
    expect(monthlyCard.getAttribute('data-state')).toBeTruthy()
    expect(monthlyCard.getAttribute('data-solvapay-plan-selector-card')).toBe('')
  })

  it('asChild composition on Card merges refs, chains handlers, forwards data-* + aria-*', async () => {
    seed([monthly, yearly])
    const consumerClick = vi.fn()
    const ref = createRef<HTMLDivElement>()
    render(
      <SolvaPayProvider config={{}}>
        <PlanSelector.Root productRef="prd_x">
          <PlanSelector.Grid>
            <PlanSelector.Card asChild aria-label="plan card">
              <div
                ref={ref}
                role="button"
                tabIndex={0}
                onClick={consumerClick}
                className="custom-card"
                data-testid="cardtile"
              >
                <PlanSelector.CardName />
              </div>
            </PlanSelector.Card>
          </PlanSelector.Grid>
        </PlanSelector.Root>
      </SolvaPayProvider>,
    )
    const tiles = await screen.findAllByTestId('cardtile')
    const yearlyTile = tiles.find(t => t.textContent === 'Yearly')
    expect(yearlyTile).toBeTruthy()
    expect(yearlyTile!.tagName).toBe('DIV')
    expect(yearlyTile!.className).toContain('custom-card')
    expect(yearlyTile!.getAttribute('aria-label')).toBe('plan card')
    expect(yearlyTile!.getAttribute('data-state')).toBe('idle')
    fireEvent.click(yearlyTile!)
    expect(consumerClick).toHaveBeenCalled()
    await waitFor(() => expect(yearlyTile!.getAttribute('data-state')).toBe('selected'))
    expect(ref.current).toBe(yearlyTile)
  })

  it('renders Loading while plans fetch and never resolves (pending fetcher)', async () => {
    let resolve: (plans: Plan[]) => void = () => {}
    const pending = new Promise<Plan[]>(r => {
      resolve = r
    })
    render(
      <SolvaPayProvider config={{}}>
        <PlanSelector.Root productRef="prd_x" fetcher={() => pending}>
          <PlanSelector.Loading data-testid="loading">Fetching…</PlanSelector.Loading>
        </PlanSelector.Root>
      </SolvaPayProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('loading')).toBeTruthy())
    resolve([monthly])
  })

  it('renders Error when fetcher throws', async () => {
    const err = new Error('boom')
    render(
      <SolvaPayProvider config={{}}>
        <PlanSelector.Root productRef="prd_x" fetcher={() => Promise.reject(err)}>
          <PlanSelector.Error data-testid="error" />
        </PlanSelector.Root>
      </SolvaPayProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('error')).toBeTruthy())
    expect(screen.getByTestId('error').textContent).toContain('boom')
    expect(screen.getByTestId('error').getAttribute('role')).toBe('alert')
  })

  it('throws MissingProviderError when rendered outside SolvaPayProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      render(
        <PlanSelector.Root productRef="prd_x">
          <PlanSelector.Grid />
        </PlanSelector.Root>,
      ),
    ).toThrow(MissingProviderError)
    spy.mockRestore()
  })

  it('throws MissingProductRefError when productRef is omitted', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      render(
        <SolvaPayProvider config={{}}>
          <PlanSelector.Root>
            <PlanSelector.Grid />
          </PlanSelector.Root>
        </SolvaPayProvider>,
      ),
    ).toThrow(MissingProductRefError)
    spy.mockRestore()
  })
})
