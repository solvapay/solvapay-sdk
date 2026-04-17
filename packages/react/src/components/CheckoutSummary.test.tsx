import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import React from 'react'
import { CheckoutSummary } from './CheckoutSummary'
import { SolvaPayProvider } from '../SolvaPayProvider'
import { plansCache } from '../hooks/usePlans'
import { productCache } from '../hooks/useProduct'
import type { Plan } from '../types'

const recurringPlan: Plan = {
  reference: 'pln_monthly',
  name: 'Monthly',
  price: 1999,
  currency: 'usd',
  type: 'recurring',
  interval: 'month',
  trialDays: 7,
}

beforeEach(() => {
  plansCache.clear()
  productCache.clear()
})

describe('CheckoutSummary', () => {
  it('renders plan name, product name, and formatted price', async () => {
    plansCache.set('prd_x', {
      plans: [recurringPlan],
      timestamp: Date.now(),
      promise: null,
    })
    productCache.set('prd_x', {
      product: { reference: 'prd_x', name: 'Widget API' },
      promise: null,
      timestamp: Date.now(),
    })
    render(
      <SolvaPayProvider config={{}}>
        <CheckoutSummary planRef="pln_monthly" productRef="prd_x" />
      </SolvaPayProvider>,
    )
    await waitFor(() => expect(screen.getByText('Monthly')).toBeTruthy())
    expect(screen.getByText('Widget API')).toBeTruthy()
    expect(screen.getByText('$19.99 / month')).toBeTruthy()
  })

  it('shows trial banner when plan has trialDays', async () => {
    plansCache.set('prd_x', {
      plans: [recurringPlan],
      timestamp: Date.now(),
      promise: null,
    })
    productCache.set('prd_x', {
      product: { reference: 'prd_x', name: 'Widget API' },
      promise: null,
      timestamp: Date.now(),
    })
    render(
      <SolvaPayProvider config={{}}>
        <CheckoutSummary planRef="pln_monthly" productRef="prd_x" />
      </SolvaPayProvider>,
    )
    await waitFor(() => expect(screen.getByText('7-day free trial')).toBeTruthy())
  })

  it('uses render-prop children to bypass default markup', async () => {
    plansCache.set('prd_x', {
      plans: [recurringPlan],
      timestamp: Date.now(),
      promise: null,
    })
    productCache.set('prd_x', {
      product: { reference: 'prd_x', name: 'Widget API' },
      promise: null,
      timestamp: Date.now(),
    })
    render(
      <SolvaPayProvider config={{}}>
        <CheckoutSummary planRef="pln_monthly" productRef="prd_x">
          {({ priceFormatted }) => <span data-testid="custom">{priceFormatted}</span>}
        </CheckoutSummary>
      </SolvaPayProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('custom').textContent).toBe('$19.99 / month'))
  })

  it('honours locale from provider (Swedish kronor)', async () => {
    const sekPlan: Plan = {
      reference: 'pln_sek',
      name: 'Standard',
      price: 19900,
      currency: 'sek',
      type: 'recurring',
      interval: 'month',
    }
    plansCache.set('prd_sek', {
      plans: [sekPlan],
      timestamp: Date.now(),
      promise: null,
    })
    productCache.set('prd_sek', {
      product: { reference: 'prd_sek', name: 'Prenumeration' },
      promise: null,
      timestamp: Date.now(),
    })
    render(
      <SolvaPayProvider config={{ locale: 'sv-SE' }}>
        <CheckoutSummary planRef="pln_sek" productRef="prd_sek" />
      </SolvaPayProvider>,
    )
    await waitFor(() => expect(screen.getByText(/199/)).toBeTruthy())
    // Swedish formatting uses "kr"
    const priceNode = screen.getByText(/199/)
    expect(priceNode.textContent?.toLowerCase()).toContain('kr')
  })
})
