import { render, screen, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { CheckoutLayout } from './CheckoutLayout'
import { SolvaPayProvider } from '../SolvaPayProvider'
import { plansCache } from '../hooks/usePlans'
import { productCache } from '../hooks/useProduct'
import { merchantCache } from '../hooks/useMerchant'
import type { Plan } from '../types'

vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'stripe-elements' }, children),
  useStripe: () => ({ confirmPayment: vi.fn(), confirmCardPayment: vi.fn() }),
  useElements: () => ({ getElement: vi.fn() }),
  CardElement: () => React.createElement('div', { 'data-testid': 'card-element' }),
  PaymentElement: () => React.createElement('div', { 'data-testid': 'payment-element' }),
}))

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(() =>
    Promise.resolve({
      confirmPayment: vi.fn(),
      confirmCardPayment: vi.fn(),
    }),
  ),
}))

const plan: Plan = {
  reference: 'pln_1',
  name: 'Monthly',
  price: 1999,
  currency: 'usd',
  type: 'recurring',
  interval: 'month',
}

type ResizeObserverCallback = (entries: { contentRect: { width: number } }[]) => void
let resizeObserverCb: ResizeObserverCallback | null = null
let resizeObserverObserved: Element | null = null

beforeEach(() => {
  plansCache.clear()
  productCache.clear()
  merchantCache.clear()
  plansCache.set('prd_x', { plans: [plan], timestamp: Date.now(), promise: null })
  productCache.set('prd_x', {
    product: { reference: 'prd_x', name: 'Widget API' },
    promise: null,
    timestamp: Date.now(),
  })
  merchantCache.set('/api/merchant', {
    merchant: {
      displayName: 'Acme',
      legalName: 'Acme Inc.',
    },
    promise: null,
    timestamp: Date.now(),
  })

  resizeObserverCb = null
  resizeObserverObserved = null
  globalThis.ResizeObserver = class {
    constructor(cb: ResizeObserverCallback) {
      resizeObserverCb = cb
    }
    observe(el: Element) {
      resizeObserverObserved = el
    }
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver
})

function triggerResize(width: number) {
  if (!resizeObserverCb) return
  act(() => {
    resizeObserverCb!([{ contentRect: { width } } as { contentRect: { width: number } }])
  })
}

const mockFetch = vi.fn().mockImplementation((url: string) => {
  if (url.startsWith('/api/create-payment-intent')) {
    return Promise.resolve(
      new Response(
        JSON.stringify({
          clientSecret: 'cs_123',
          publishableKey: 'pk_test',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
  }
  return Promise.resolve(new Response('{}', { status: 200 }))
})

const renderLayout = (
  props: Partial<React.ComponentProps<typeof CheckoutLayout>> = {},
) =>
  render(
    <SolvaPayProvider config={{ fetch: mockFetch as unknown as typeof fetch }}>
      <CheckoutLayout
        planRef="pln_1"
        productRef="prd_x"
        {...props}
      />
    </SolvaPayProvider>,
  )

describe('CheckoutLayout', () => {
  it('renders the checkout summary and payment surface', async () => {
    renderLayout()
    await waitFor(() => expect(screen.getByText('Widget API')).toBeTruthy())
    expect(screen.getByText('Monthly')).toBeTruthy()
  })

  it('renders chat-sized layout when size="chat"', async () => {
    const { container } = renderLayout({ size: 'chat' })
    await waitFor(() =>
      expect(
        container.querySelector('[data-solvapay-checkout-layout="chat"]'),
      ).toBeTruthy(),
    )
  })

  it('renders desktop layout when size="desktop"', async () => {
    const { container } = renderLayout({ size: 'desktop' })
    await waitFor(() =>
      expect(
        container.querySelector('[data-solvapay-checkout-layout="desktop"]'),
      ).toBeTruthy(),
    )
  })

  it('reflows via ResizeObserver when size="auto"', async () => {
    const { container } = renderLayout({ size: 'auto' })
    // ResizeObserver should be wired
    await waitFor(() => expect(resizeObserverObserved).toBeTruthy())
    triggerResize(400)
    await waitFor(() =>
      expect(
        container.querySelector('[data-solvapay-checkout-layout="chat"]'),
      ).toBeTruthy(),
    )
    triggerResize(900)
    await waitFor(() =>
      expect(
        container.querySelector('[data-solvapay-checkout-layout="desktop"]'),
      ).toBeTruthy(),
    )
  })

  it('applies classNames prop', async () => {
    const { container } = renderLayout({
      classNames: { root: 'my-root' },
    })
    await waitFor(() => expect(container.querySelector('.my-root')).toBeTruthy())
  })
})

const usagePlan: Plan = {
  reference: 'pln_usage',
  name: 'Usage',
  currency: 'usd',
  type: 'usage-based',
  billingModel: 'pre-paid',
  creditsPerUnit: 100,
  measures: 'call',
  requiresPayment: true,
}

const freePlan: Plan = {
  reference: 'pln_free',
  name: 'Starter',
  price: 0,
  currency: 'usd',
  type: 'recurring',
  interval: 'month',
  requiresPayment: false,
}

describe('CheckoutLayout — new orchestration', () => {
  it('with planRef omitted, renders the PlanSelector step', async () => {
    plansCache.set('prd_multi', {
      plans: [plan, { ...plan, reference: 'pln_2', name: 'Yearly', interval: 'year' }],
      timestamp: Date.now(),
      promise: null,
    })
    productCache.set('prd_multi', {
      product: { reference: 'prd_multi', name: 'Widget API' },
      promise: null,
      timestamp: Date.now(),
    })
    render(
      <SolvaPayProvider config={{ fetch: mockFetch as unknown as typeof fetch }}>
        <CheckoutLayout productRef="prd_multi" />
      </SolvaPayProvider>,
    )
    await waitFor(() => expect(screen.getByText('Choose your pricing')).toBeTruthy())
    expect(screen.getByText('Monthly')).toBeTruthy()
    expect(screen.getByText('Yearly')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy()
  })

  it('routes usage-based plans to ActivationFlow automatically', async () => {
    plansCache.set('prd_usage', {
      plans: [usagePlan],
      timestamp: Date.now(),
      promise: null,
    })
    productCache.set('prd_usage', {
      product: { reference: 'prd_usage', name: 'Metered API' },
      promise: null,
      timestamp: Date.now(),
    })
    render(
      <SolvaPayProvider config={{ fetch: mockFetch as unknown as typeof fetch }}>
        <CheckoutLayout planRef="pln_usage" productRef="prd_usage" />
      </SolvaPayProvider>,
    )
    await waitFor(() => expect(screen.getByText('Confirm your plan')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Activate' })).toBeTruthy()
  })

  it('routes free plans through the PaymentForm free branch', async () => {
    plansCache.set('prd_free', {
      plans: [freePlan],
      timestamp: Date.now(),
      promise: null,
    })
    productCache.set('prd_free', {
      product: { reference: 'prd_free', name: 'Widget API' },
      promise: null,
      timestamp: Date.now(),
    })
    render(
      <SolvaPayProvider config={{ fetch: mockFetch as unknown as typeof fetch }}>
        <CheckoutLayout planRef="pln_free" productRef="prd_free" />
      </SolvaPayProvider>,
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Start using/ })).toBeTruthy(),
    )
  })

  it('renderActivation overrides the default ActivationFlow', async () => {
    plansCache.set('prd_usage', {
      plans: [usagePlan],
      timestamp: Date.now(),
      promise: null,
    })
    productCache.set('prd_usage', {
      product: { reference: 'prd_usage', name: 'Metered API' },
      promise: null,
      timestamp: Date.now(),
    })
    render(
      <SolvaPayProvider config={{ fetch: mockFetch as unknown as typeof fetch }}>
        <CheckoutLayout
          planRef="pln_usage"
          productRef="prd_usage"
          renderActivation={({ plan }) => (
            <div data-testid="custom-activation">{plan.reference}</div>
          )}
        />
      </SolvaPayProvider>,
    )
    await waitFor(() =>
      expect(screen.getByTestId('custom-activation').textContent).toBe('pln_usage'),
    )
  })

  it('back button returns from pay step to select when planRef is omitted', async () => {
    plansCache.set('prd_multi', {
      plans: [plan, { ...plan, reference: 'pln_2', name: 'Yearly', interval: 'year' }],
      timestamp: Date.now(),
      promise: null,
    })
    productCache.set('prd_multi', {
      product: { reference: 'prd_multi', name: 'Widget API' },
      promise: null,
      timestamp: Date.now(),
    })
    render(
      <SolvaPayProvider config={{ fetch: mockFetch as unknown as typeof fetch }}>
        <CheckoutLayout productRef="prd_multi" />
      </SolvaPayProvider>,
    )
    const continueBtn = await screen.findByRole('button', { name: 'Continue' })
    act(() => {
      // pick the first plan + continue
      screen.getByText('Monthly').click()
    })
    act(() => {
      continueBtn.click()
    })
    await waitFor(() => expect(screen.queryByText('Choose your pricing')).toBeNull())
    const back = screen.getByRole('button', { name: /Back to plans/ })
    act(() => {
      back.click()
    })
    await waitFor(() => expect(screen.getByText('Choose your pricing')).toBeTruthy())
  })

  it('auto-skips the selector when there is only one plan', async () => {
    plansCache.set('prd_single', {
      plans: [plan],
      timestamp: Date.now(),
      promise: null,
    })
    productCache.set('prd_single', {
      product: { reference: 'prd_single', name: 'Widget API' },
      promise: null,
      timestamp: Date.now(),
    })
    render(
      <SolvaPayProvider config={{ fetch: mockFetch as unknown as typeof fetch }}>
        <CheckoutLayout productRef="prd_single" />
      </SolvaPayProvider>,
    )
    // Should skip 'Choose your pricing' and go straight to pay step.
    await waitFor(() =>
      expect(screen.queryByText('Choose your pricing')).toBeNull(),
    )
  })
})
