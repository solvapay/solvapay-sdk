import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import React, { createRef } from 'react'
import { CheckoutSummary as ShimCheckoutSummary } from './CheckoutSummary'
import {
  CheckoutSummary,
  useCheckoutSummary as useCheckoutSummaryFromHook,
} from '../primitives/CheckoutSummary'
import { SolvaPayProvider } from '../SolvaPayProvider'
import { plansCache } from '../hooks/usePlans'
import { productCache } from '../hooks/useProduct'
import { MissingProviderError } from '../utils/errors'
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

function seed(plan: Plan = recurringPlan, productName = 'Widget API') {
  plansCache.set('prd_x', { plans: [plan], timestamp: Date.now(), promise: null })
  productCache.set('prd_x', {
    product: { reference: 'prd_x', name: productName },
    promise: null,
    timestamp: Date.now(),
  })
}

beforeEach(() => {
  plansCache.clear()
  productCache.clear()
})

describe('CheckoutSummary (default-tree shim)', () => {
  it('renders product name, plan name, and formatted price', async () => {
    seed()
    render(
      <SolvaPayProvider config={{}}>
        <ShimCheckoutSummary planRef="pln_monthly" productRef="prd_x" />
      </SolvaPayProvider>,
    )
    await waitFor(() => expect(screen.getByText('Monthly')).toBeTruthy())
    expect(screen.getByText('Widget API')).toBeTruthy()
    expect(screen.getByText('$19.99 / month')).toBeTruthy()
  })

  it('shows trial banner when plan has trialDays and showTrial=true', async () => {
    seed()
    render(
      <SolvaPayProvider config={{}}>
        <ShimCheckoutSummary planRef="pln_monthly" productRef="prd_x" />
      </SolvaPayProvider>,
    )
    await waitFor(() => expect(screen.getByText('7-day free trial')).toBeTruthy())
  })

  it('hides trial banner when showTrial=false', async () => {
    seed()
    render(
      <SolvaPayProvider config={{}}>
        <ShimCheckoutSummary planRef="pln_monthly" productRef="prd_x" showTrial={false} />
      </SolvaPayProvider>,
    )
    await waitFor(() => expect(screen.getByText('Monthly')).toBeTruthy())
    expect(screen.queryByText('7-day free trial')).toBeNull()
  })

  it('renders a tax note only when showTaxNote=true', async () => {
    seed()
    const { rerender } = render(
      <SolvaPayProvider config={{}}>
        <ShimCheckoutSummary planRef="pln_monthly" productRef="prd_x" />
      </SolvaPayProvider>,
    )
    await waitFor(() => expect(screen.getByText('Monthly')).toBeTruthy())
    expect(screen.queryByText(/Taxes calculated/i)).toBeNull()

    rerender(
      <SolvaPayProvider config={{}}>
        <ShimCheckoutSummary planRef="pln_monthly" productRef="prd_x" showTaxNote />
      </SolvaPayProvider>,
    )
    expect(screen.getByText(/Taxes calculated/i)).toBeTruthy()
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
    plansCache.set('prd_sek', { plans: [sekPlan], timestamp: Date.now(), promise: null })
    productCache.set('prd_sek', {
      product: { reference: 'prd_sek', name: 'Prenumeration' },
      promise: null,
      timestamp: Date.now(),
    })
    render(
      <SolvaPayProvider config={{ locale: 'sv-SE' }}>
        <ShimCheckoutSummary planRef="pln_sek" productRef="prd_sek" />
      </SolvaPayProvider>,
    )
    await waitFor(() => expect(screen.getByText(/199/)).toBeTruthy())
    const priceNode = screen.getByText(/199/)
    expect(priceNode.textContent?.toLowerCase()).toContain('kr')
  })
})

describe('CheckoutSummary primitive', () => {
  it('renders subcomponents as slotted DOM with opaque selectors', async () => {
    seed()
    render(
      <SolvaPayProvider config={{}}>
        <CheckoutSummary.Root planRef="pln_monthly" productRef="prd_x" data-testid="root">
          <CheckoutSummary.Product data-testid="product" />
          <CheckoutSummary.Plan data-testid="plan" />
          <CheckoutSummary.Price data-testid="price" />
          <CheckoutSummary.Trial data-testid="trial" />
        </CheckoutSummary.Root>
      </SolvaPayProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('plan').textContent).toBe('Monthly'))
    expect(screen.getByTestId('root').getAttribute('data-solvapay-checkout-summary')).toBe('')
    expect(
      screen.getByTestId('product').getAttribute('data-solvapay-checkout-summary-product'),
    ).toBe('')
    expect(screen.getByTestId('price').textContent).toBe('$19.99 / month')
    expect(screen.getByTestId('trial').textContent).toBe('7-day free trial')
  })

  it('composes via asChild: swaps element shell, merges refs, forwards data-* / aria-*, merges className', async () => {
    seed()
    const ref = createRef<HTMLAnchorElement>()
    render(
      <SolvaPayProvider config={{}}>
        <CheckoutSummary.Root planRef="pln_monthly" productRef="prd_x">
          <CheckoutSummary.Price
            asChild
            data-testid="price"
            aria-label="plan price"
            className="from-primitive"
          >
            <a ref={ref} href="#plan" className="from-consumer">
              Priced link
            </a>
          </CheckoutSummary.Price>
        </CheckoutSummary.Root>
      </SolvaPayProvider>,
    )
    const node = await screen.findByTestId('price')
    expect(node.tagName).toBe('A')
    expect(node.textContent).toBe('Priced link')
    expect(node.getAttribute('href')).toBe('#plan')
    expect(node.getAttribute('aria-label')).toBe('plan price')
    expect(node.getAttribute('data-solvapay-checkout-summary-price')).toBe('')
    expect(node.className).toContain('from-primitive')
    expect(node.className).toContain('from-consumer')
    expect(ref.current).toBe(node)
  })

  it('useCheckoutSummary hook exposes computed state for fully custom leaves', async () => {
    seed()
    const Custom = () => {
      const { priceFormatted, plan } = useCheckoutSummaryFromHook()
      return (
        <a href="#plan" data-testid="custom-price">
          {plan?.name} — {priceFormatted}
        </a>
      )
    }
    render(
      <SolvaPayProvider config={{}}>
        <CheckoutSummary.Root planRef="pln_monthly" productRef="prd_x">
          <Custom />
        </CheckoutSummary.Root>
      </SolvaPayProvider>,
    )
    await waitFor(() =>
      expect(screen.getByTestId('custom-price').textContent).toBe('Monthly — $19.99 / month'),
    )
  })

  it('renders null for Product / Trial when their source data is absent', async () => {
    const noTrialPlan: Plan = {
      reference: 'pln_nt',
      name: 'Plain',
      price: 1000,
      currency: 'usd',
      type: 'recurring',
      interval: 'month',
    }
    plansCache.set('prd_x', { plans: [noTrialPlan], timestamp: Date.now(), promise: null })
    productCache.set('prd_x', { product: null, promise: null, timestamp: Date.now() })
    render(
      <SolvaPayProvider config={{}}>
        <CheckoutSummary.Root planRef="pln_nt" productRef="prd_x">
          <CheckoutSummary.Product data-testid="product" />
          <CheckoutSummary.Plan data-testid="plan" />
          <CheckoutSummary.Trial data-testid="trial" />
        </CheckoutSummary.Root>
      </SolvaPayProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('plan').textContent).toBe('Plain'))
    expect(screen.queryByTestId('product')).toBeNull()
    expect(screen.queryByTestId('trial')).toBeNull()
  })

  it('throws MissingProviderError when rendered outside SolvaPayProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      render(
        <CheckoutSummary.Root planRef="pln_monthly" productRef="prd_x">
          <CheckoutSummary.Plan />
        </CheckoutSummary.Root>,
      ),
    ).toThrow(MissingProviderError)
    spy.mockRestore()
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})
