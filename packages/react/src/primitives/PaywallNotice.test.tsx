/// <reference types="@testing-library/jest-dom" />
/**
 * Focused tests for the post-fix behavior of `<PaywallNotice>`:
 *
 * 1. `Message` prefers the new client-side copy (built from `balance` +
 *    `productDetails`) over the raw server `message` when the
 *    `payment_required` content carries structured balance data; falls
 *    back to `content.message` otherwise.
 * 2. `EmbeddedCheckout` branches on the selected plan's type — PAYG
 *    (`usage-based` / `hybrid`) mounts `<AmountPicker>` → `<TopupForm>`
 *    rather than the recurring `<PaymentForm>`. The previous
 *    implementation always mounted `PaymentForm` and blew up with
 *    Stripe's minimum-charge error on PAYG plans.
 * 3. `Plans` and `EmbeddedCheckout` pass a Free-filtering `filter` prop
 *    to `<PlanSelector.Root>` so the paywall never renders a disabled
 *    Free card as decoration.
 *
 * Child primitives are mocked so we can assert on their received props
 * without setting up Stripe Elements / transport / provider scaffolding.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import type { PaywallStructuredContent } from '@solvapay/server'
import type { Plan } from '../types'

// Mock `usePaywallResolver` up front so the `Root` doesn't try to
// subscribe to live provider state.
vi.mock('../hooks/usePaywallResolver', () => ({
  usePaywallResolver: () => ({ resolved: false, refetch: vi.fn() }),
}))

type SelectedPlanShape = Plan | null

let currentSelectedPlan: SelectedPlanShape = null

// Mock `PlanSelector` to surface the `filter` prop so we can assert the
// paywall passes it, and to drive `usePlanSelector()` inside the gate.
vi.mock('./PlanSelector', () => {
  const Root = (props: {
    productRef?: string
    filter?: (plan: Plan) => boolean
    children?: React.ReactNode
  }) =>
    React.createElement(
      'div',
      {
        'data-testid': 'plan-selector-root',
        'data-has-filter': props.filter ? 'true' : 'false',
        'data-filter-hides-free': props.filter
          ? String(
              props.filter({ reference: 'pln_free', requiresPayment: false }) === false,
            )
          : 'n/a',
      },
      props.children,
    )
  const Stub = (tag: string) => {
    const Component = (props: { children?: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': tag }, props.children ?? null)
    Component.displayName = `Stub(${tag})`
    return Component
  }
  return {
    PlanSelector: Object.assign(Root, {
      Root,
      Grid: Stub('plan-selector-grid'),
      Card: Stub('plan-selector-card'),
      CardBadge: Stub('plan-selector-card-badge'),
      CardName: Stub('plan-selector-card-name'),
      CardPrice: Stub('plan-selector-card-price'),
      CardInterval: Stub('plan-selector-card-interval'),
      Loading: Stub('plan-selector-loading'),
      Error: Stub('plan-selector-error'),
    }),
    usePlanSelector: () => ({
      selectedPlan: currentSelectedPlan,
      selectedPlanRef: currentSelectedPlan?.reference ?? null,
    }),
  }
})

// `PaymentForm` is the recurring-only branch after the fix.
vi.mock('./PaymentForm', () => {
  const Root = (props: {
    planRef?: string
    productRef?: string
    children?: React.ReactNode
  }) =>
    React.createElement(
      'div',
      {
        'data-testid': 'payment-form-root',
        'data-plan-ref': props.planRef,
        'data-product-ref': props.productRef,
      },
      props.children ?? null,
    )
  const Stub = (tag: string) => {
    const Component = () => React.createElement('div', { 'data-testid': tag })
    Component.displayName = `Stub(${tag})`
    return Component
  }
  return {
    PaymentForm: Object.assign(Root, {
      Root,
      Summary: Stub('payment-form-summary'),
      Loading: Stub('payment-form-loading'),
      PaymentElement: Stub('payment-form-element'),
      Error: Stub('payment-form-error'),
      MandateText: Stub('payment-form-mandate'),
      SubmitButton: Stub('payment-form-submit'),
    }),
  }
})

// `AmountPicker` + `TopupForm` replace `PaymentForm` on the PAYG branch.
vi.mock('./AmountPicker', () => {
  const Root = (props: {
    currency?: string
    emit?: string
    children?: React.ReactNode
  }) =>
    React.createElement(
      'div',
      {
        'data-testid': 'amount-picker-root',
        'data-currency': props.currency,
        'data-emit': props.emit,
      },
      props.children,
    )
  const Stub = (tag: string) => {
    const Component = (props: { children?: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': tag }, props.children ?? null)
    Component.displayName = `Stub(${tag})`
    return Component
  }
  return {
    AmountPicker: Object.assign(Root, {
      Root,
      Custom: Stub('amount-picker-custom'),
      Confirm: Stub('amount-picker-confirm'),
      Option: Stub('amount-picker-option'),
    }),
  }
})

vi.mock('./TopupForm', () => {
  const Root = (props: {
    amount?: number
    currency?: string
    children?: React.ReactNode
  }) =>
    React.createElement(
      'div',
      {
        'data-testid': 'topup-form-root',
        'data-amount': String(props.amount ?? ''),
        'data-currency': props.currency,
      },
      props.children ?? null,
    )
  const Stub = (tag: string) => {
    const Component = () => React.createElement('div', { 'data-testid': tag })
    Component.displayName = `Stub(${tag})`
    return Component
  }
  return {
    TopupForm: Object.assign(Root, {
      Root,
      Loading: Stub('topup-form-loading'),
      PaymentElement: Stub('topup-form-element'),
      Error: Stub('topup-form-error'),
      SubmitButton: Stub('topup-form-submit'),
    }),
  }
})

// Load after mocks are registered.
import { PaywallNotice } from './PaywallNotice'

const baseProduct = 'prd_abc'

beforeEach(() => {
  currentSelectedPlan = null
})

describe('PaywallNotice.Message', () => {
  it('renders the server-provided message when the content has no balance', () => {
    const content: PaywallStructuredContent = {
      kind: 'payment_required',
      product: baseProduct,
      checkoutUrl: 'https://example.test/c',
      message: 'Purchase required. Remaining: 0',
    }
    render(
      <PaywallNotice.Root content={content}>
        <PaywallNotice.Message data-testid="message" />
      </PaywallNotice.Root>,
    )
    expect(screen.getByTestId('message').textContent).toBe(
      'Purchase required. Remaining: 0',
    )
  })

  it('prefers client-side copy when the payment_required content carries balance', () => {
    const content: PaywallStructuredContent = {
      kind: 'payment_required',
      product: baseProduct,
      checkoutUrl: '',
      message: 'Purchase required. Remaining: 0',
      balance: { remainingUnits: 0 },
      productDetails: { name: 'Knowledge API', reference: baseProduct },
    }
    render(
      <PaywallNotice.Root content={content}>
        <PaywallNotice.Message data-testid="message" />
      </PaywallNotice.Root>,
    )
    const text = screen.getByTestId('message').textContent ?? ''
    expect(text).toContain('Knowledge API')
    expect(text).toContain('Choose a plan')
    expect(text).not.toBe('Purchase required. Remaining: 0')
  })

  it('uses the remaining-count copy (with plural) when some quota is left', () => {
    const content: PaywallStructuredContent = {
      kind: 'payment_required',
      product: baseProduct,
      checkoutUrl: '',
      message: 'Purchase required. Remaining: 3',
      balance: { remainingUnits: 3 },
    }
    render(
      <PaywallNotice.Root content={content}>
        <PaywallNotice.Message data-testid="message" />
      </PaywallNotice.Root>,
    )
    const text = screen.getByTestId('message').textContent ?? ''
    expect(text).toContain('3 calls left')
  })
})

describe('PaywallNotice.Plans', () => {
  it('passes a Free-hiding filter to PlanSelector', () => {
    const content: PaywallStructuredContent = {
      kind: 'activation_required',
      product: baseProduct,
      checkoutUrl: '',
      message: 'activate',
    }
    render(
      <PaywallNotice.Root content={content}>
        <PaywallNotice.Plans />
      </PaywallNotice.Root>,
    )
    const selector = screen.getByTestId('plan-selector-root')
    expect(selector.getAttribute('data-has-filter')).toBe('true')
    // Filter returns `false` for `requiresPayment === false`, i.e. Free.
    expect(selector.getAttribute('data-filter-hides-free')).toBe('true')
  })
})

describe('PaywallNotice.EmbeddedCheckout', () => {
  const content: PaywallStructuredContent = {
    kind: 'payment_required',
    product: baseProduct,
    checkoutUrl: '',
    message: 'Purchase required',
  }

  it('passes a Free-hiding filter to PlanSelector', () => {
    currentSelectedPlan = null
    render(
      <PaywallNotice.Root content={content}>
        <PaywallNotice.EmbeddedCheckout returnUrl="https://example.test/r" />
      </PaywallNotice.Root>,
    )
    const selector = screen.getByTestId('plan-selector-root')
    expect(selector.getAttribute('data-has-filter')).toBe('true')
    expect(selector.getAttribute('data-filter-hides-free')).toBe('true')
  })

  it('mounts AmountPicker (not PaymentForm) when the selected plan is usage-based', () => {
    currentSelectedPlan = {
      reference: 'pln_payg',
      type: 'usage-based',
      currency: 'sek',
      requiresPayment: true,
    }
    render(
      <PaywallNotice.Root content={content}>
        <PaywallNotice.EmbeddedCheckout returnUrl="https://example.test/r" />
      </PaywallNotice.Root>,
    )
    const picker = screen.getByTestId('amount-picker-root')
    expect(picker.getAttribute('data-currency')).toBe('SEK')
    expect(picker.getAttribute('data-emit')).toBe('minor')
    expect(screen.queryByTestId('payment-form-root')).toBeNull()
    // TopupForm only mounts *after* the amount is confirmed.
    expect(screen.queryByTestId('topup-form-root')).toBeNull()
  })

  it('mounts PaymentForm for a recurring selected plan (regression guard)', () => {
    currentSelectedPlan = {
      reference: 'pln_rec',
      type: 'recurring',
      currency: 'usd',
      price: 1000,
      requiresPayment: true,
    }
    render(
      <PaywallNotice.Root content={content}>
        <PaywallNotice.EmbeddedCheckout returnUrl="https://example.test/r" />
      </PaywallNotice.Root>,
    )
    expect(screen.getByTestId('payment-form-root')).toBeTruthy()
    expect(screen.queryByTestId('amount-picker-root')).toBeNull()
    expect(screen.queryByTestId('topup-form-root')).toBeNull()
  })

  it('renders nothing inside the gate until a plan is selected', () => {
    currentSelectedPlan = null
    render(
      <PaywallNotice.Root content={content}>
        <PaywallNotice.EmbeddedCheckout returnUrl="https://example.test/r" />
      </PaywallNotice.Root>,
    )
    expect(screen.queryByTestId('amount-picker-root')).toBeNull()
    expect(screen.queryByTestId('payment-form-root')).toBeNull()
    expect(screen.queryByTestId('topup-form-root')).toBeNull()
  })
})
