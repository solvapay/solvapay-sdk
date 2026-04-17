import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import React from 'react'
import { PlanSelector } from './PlanSelector'
import { CheckoutSummary } from './CheckoutSummary'
import { SolvaPayProvider } from '../SolvaPayProvider'
import { plansCache } from '../hooks/usePlans'
import { productCache } from '../hooks/useProduct'
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

function seedPlans(plans: Plan[]) {
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

describe('PlanSelector', () => {
  it('renders default heading + card grid with formatted prices', async () => {
    seedPlans([monthly, yearly])
    render(
      <SolvaPayProvider config={{}}>
        <PlanSelector productRef="prd_x" />
      </SolvaPayProvider>,
    )
    await waitFor(() => expect(screen.getByText('Choose your pricing')).toBeTruthy())
    expect(screen.getByText('Monthly')).toBeTruthy()
    expect(screen.getByText('Yearly')).toBeTruthy()
    expect(screen.getByText('$19.99')).toBeTruthy()
    expect(screen.getByText('$199.00')).toBeTruthy()
    expect(screen.getByText('/month')).toBeTruthy()
    expect(screen.getByText('7-day free trial')).toBeTruthy()
  })

  it('calls onSelect when a plan card is clicked', async () => {
    seedPlans([monthly, yearly])
    const onSelect = vi.fn()
    render(
      <SolvaPayProvider config={{}}>
        <PlanSelector productRef="prd_x" onSelect={onSelect} />
      </SolvaPayProvider>,
    )
    const yearlyCard = await screen.findByText('Yearly')
    fireEvent.click(yearlyCard.closest('button')!)
    expect(onSelect).toHaveBeenCalledWith('pln_yearly', expect.objectContaining({ reference: 'pln_yearly' }))
  })

  it('dims and disables free plans and shows the Free badge', async () => {
    seedPlans([monthly, free])
    const onSelect = vi.fn()
    render(
      <SolvaPayProvider config={{}}>
        <PlanSelector productRef="prd_x" onSelect={onSelect} />
      </SolvaPayProvider>,
    )
    await screen.findByText('Monthly')
    expect(screen.getByText('Free')).toBeTruthy()
    const freeCard = screen.getByText('Starter').closest('button') as HTMLButtonElement
    expect(freeCard.disabled).toBe(true)
    fireEvent.click(freeCard)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('marks currentPlanRef with the Current badge and disables it', async () => {
    seedPlans([monthly, yearly])
    render(
      <SolvaPayProvider config={{}}>
        <PlanSelector productRef="prd_x" currentPlanRef="pln_monthly" />
      </SolvaPayProvider>,
    )
    await screen.findByText('Monthly')
    expect(screen.getByText('Current')).toBeTruthy()
    const currentCard = screen.getByText('Monthly').closest('button') as HTMLButtonElement
    expect(currentCard.disabled).toBe(true)
  })

  it('renders the Popular badge on popularPlanRef', async () => {
    seedPlans([monthly, yearly])
    render(
      <SolvaPayProvider config={{}}>
        <PlanSelector productRef="prd_x" popularPlanRef="pln_yearly" />
      </SolvaPayProvider>,
    )
    await screen.findByText('Monthly')
    expect(screen.getByText('Popular')).toBeTruthy()
  })

  it('supports function-child render prop', async () => {
    seedPlans([monthly, yearly])
    render(
      <SolvaPayProvider config={{}}>
        <PlanSelector productRef="prd_x">
          {({ plans, select, selectedPlanRef }) => (
            <ul data-testid="custom-plans">
              {plans.map(p => (
                <li key={p.reference}>
                  <button
                    type="button"
                    onClick={() => select(p.reference)}
                    data-selected={selectedPlanRef === p.reference || undefined}
                  >
                    {p.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </PlanSelector>
      </SolvaPayProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('custom-plans')).toBeTruthy())
    expect(screen.getByText('Monthly')).toBeTruthy()
  })

  it('shares selected plan via PlanSelectionContext to nested consumers', async () => {
    seedPlans([monthly, yearly])
    render(
      <SolvaPayProvider config={{}}>
        <PlanSelector productRef="prd_x" initialPlanRef="pln_yearly">
          {({ plans }) => (
            <div>
              <span data-testid="count">{plans.length}</span>
              <CheckoutSummary />
            </div>
          )}
        </PlanSelector>
      </SolvaPayProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2'))
    expect(screen.getByText('$199.00 / year')).toBeTruthy()
  })
})
