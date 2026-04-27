import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import React from 'react'

// Stub Next.js navigation + router so the page renders in jsdom.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

// Capture the CheckoutLayout props the page hands us — the point of this
// smoke test is "the demo page mounts <CheckoutLayout> with the expected
// productRef/onResult wiring", not to exercise the SDK internals.
const layoutCalls: Array<Record<string, unknown>> = []
vi.mock('@solvapay/react', () => ({
  useCustomer: () => ({ email: 'test@example.com', name: 'Test User' }),
  usePurchase: () => ({ activePurchase: null }),
  CheckoutLayout: (props: Record<string, unknown>) => {
    layoutCalls.push(props)
    return React.createElement('div', { 'data-testid': 'checkout-layout' })
  },
  CancelledPlanNotice: () =>
    React.createElement('div', { 'data-testid': 'cancelled-notice' }),
  CancelPlanButton: () =>
    React.createElement('button', { 'data-testid': 'cancel-plan' }, 'cancel'),
}))

import CheckoutPage from '../page'

beforeEach(() => {
  layoutCalls.length = 0
  process.env.NEXT_PUBLIC_PRODUCT_REF = 'prd_smoke'
})

describe('CheckoutPage (smoke)', () => {
  it('mounts CheckoutLayout with the configured productRef and prefill', () => {
    render(<CheckoutPage />)
    expect(layoutCalls).toHaveLength(1)
    const props = layoutCalls[0]
    expect(props.productRef).toBe('prd_smoke')
    expect(props.prefillCustomer).toEqual({
      email: 'test@example.com',
      name: 'Test User',
    })
    expect(props.requireTermsAcceptance).toBe(true)
    expect(typeof props.onResult).toBe('function')
    expect(typeof props.onError).toBe('function')
  })
})
