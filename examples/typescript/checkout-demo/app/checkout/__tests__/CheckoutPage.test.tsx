import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

const flowPanelCalls: Array<Record<string, unknown>> = []
vi.mock('@solvapay/react', () => ({
  usePurchase: () => ({ activePurchase: null }),
  CancelledPlanNotice: () => React.createElement('div', { 'data-testid': 'cancelled-notice' }),
  CancelPlanButton: () => React.createElement('button', { 'data-testid': 'cancel-plan' }, 'cancel'),
}))
vi.mock('../components/CheckoutFlowPanel', () => ({
  CheckoutFlowPanel: (props: Record<string, unknown>) => {
    flowPanelCalls.push(props)
    return React.createElement('div', { 'data-testid': 'checkout-flow-panel' })
  },
}))

import CheckoutPage from '../page'

beforeEach(() => {
  flowPanelCalls.length = 0
  process.env.NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF = 'prd_smoke'
})

describe('CheckoutPage (smoke)', () => {
  it('mounts CheckoutFlowPanel with the configured productRef', () => {
    render(<CheckoutPage />)
    expect(flowPanelCalls).toHaveLength(1)
    const props = flowPanelCalls[0]
    expect(props.productRef).toBe('prd_smoke')
    expect(typeof props.returnUrl).toBe('string')
    expect(typeof props.onPurchaseSuccess).toBe('function')
    expect(typeof props.onError).toBe('function')
  })

  describe('when NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF is unset', () => {
    const previous = process.env.NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF

    afterEach(() => {
      if (previous === undefined) {
        delete process.env.NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF
      } else {
        process.env.NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF = previous
      }
    })

    it('shows inline config error instead of throwing', () => {
      delete process.env.NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF
      render(<CheckoutPage />)
      expect(flowPanelCalls).toHaveLength(0)
      expect(
        screen.getByText(/Missing NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF environment variable/i),
      ).toBeInTheDocument()
    })
  })
})
