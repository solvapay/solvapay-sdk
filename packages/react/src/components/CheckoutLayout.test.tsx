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
