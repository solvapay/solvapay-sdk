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
          ? String(props.filter({ reference: 'pln_free', requiresPayment: false }) === false)
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
  const Root = (props: { planRef?: string; productRef?: string; children?: React.ReactNode }) =>
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
  const Root = (props: { currency?: string; emit?: string; children?: React.ReactNode }) =>
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
  const Root = (props: { amount?: number; currency?: string; children?: React.ReactNode }) =>
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
import { SolvaPayContext } from '../SolvaPayProvider'

const baseProduct = 'prd_abc'

// Minimal SolvaPay context for parts that read `useTransport` / balance.
// The mocked PlanSelector and form roots short-circuit any real network
// calls; we just need to satisfy the `useSolvaPay` provider check.
function makeMinimalContext() {
  return {
    purchase: {
      loading: false,
      isRefetching: false,
      error: null,
      purchases: [],
      hasProduct: () => false,
      activePurchase: null,
      hasPaidPurchase: false,
      activePaidPurchase: null,
      balanceTransactions: [],
      customerRef: 'cus_test',
      email: undefined,
      name: undefined,
    },
    refetchPurchase: vi.fn(),
    createPayment: vi.fn(),
    createTopupPayment: vi.fn(),
    cancelRenewal: vi.fn(),
    reactivateRenewal: vi.fn(),
    activatePlan: vi.fn(),
    balance: {
      loading: false,
      credits: 0,
      displayCurrency: 'USD',
      creditsPerMinorUnit: null,
      displayExchangeRate: null,
      refetch: vi.fn(),
      adjustBalance: vi.fn(),
    },
    _config: { transport: { activatePlan: vi.fn() } },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

const renderWithProvider = (ui: React.ReactNode) =>
  render(<SolvaPayContext.Provider value={makeMinimalContext()}>{ui}</SolvaPayContext.Provider>)

beforeEach(() => {
  currentSelectedPlan = null
})

describe('PaywallNotice.Message', () => {
  // Coverage matrix: (kind × balance presence × remaining > 0)
  //   payment_required + balance.remaining=0   → paymentRequiredMessage
  //   payment_required + balance.remaining=3   → paymentRequiredMessageRemaining
  //   payment_required + no balance            → paymentRequiredMessageNoBalance (web-friendly)
  //   activation_required (any balance)        → activationRequiredMessage (web-friendly)
  //   unknown future kind                      → content.message (forward-compat)

  it('uses paymentRequiredMessageNoBalance for payment_required without a balance block — never the MCP-flavored server message', () => {
    const content: PaywallStructuredContent = {
      kind: 'payment_required',
      product: baseProduct,
      checkoutUrl: 'https://example.test/c',
      message: 'Call the `upgrade` tool to keep going.',
    }
    render(
      <PaywallNotice.Root content={content}>
        <PaywallNotice.Message data-testid="message" />
      </PaywallNotice.Root>,
    )
    const text = screen.getByTestId('message').textContent ?? ''
    expect(text).not.toMatch(/`upgrade`/)
    expect(text).toMatch(/Pick a plan|Choose a plan|keep chatting|keep going/i)
  })

  it('prefers client-side copy when the payment_required content carries balance', () => {
    const content: PaywallStructuredContent = {
      kind: 'payment_required',
      product: baseProduct,
      checkoutUrl: '',
      message: 'Purchase required. Remaining: 0',
      balance: { remainingUnits: 0, creditBalance: 0, creditsPerUnit: 1, currency: 'usd' },
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
      balance: { remainingUnits: 3, creditBalance: 3, creditsPerUnit: 1, currency: 'usd' },
    }
    render(
      <PaywallNotice.Root content={content}>
        <PaywallNotice.Message data-testid="message" />
      </PaywallNotice.Root>,
    )
    const text = screen.getByTestId('message').textContent ?? ''
    expect(text).toContain('3 calls left')
  })

  it('uses activationRequiredMessage for activation_required — never the MCP-flavored server message', () => {
    const content: PaywallStructuredContent = {
      kind: 'activation_required',
      product: baseProduct,
      checkoutUrl: '',
      message: 'Call the `activate_plan` tool to continue.',
      productDetails: { name: 'Knowledge API', reference: baseProduct },
    }
    render(
      <PaywallNotice.Root content={content}>
        <PaywallNotice.Message data-testid="message" />
      </PaywallNotice.Root>,
    )
    const text = screen.getByTestId('message').textContent ?? ''
    expect(text).not.toMatch(/`activate_plan`/)
    // Host-neutral second-person copy — no "tool", no MCP framing.
    expect(text).not.toMatch(/\btool\b/i)
    expect(text).toMatch(/active plan/i)
    expect(text).toMatch(/to continue/i)
    expect(text).toContain('Knowledge API')
  })

  it('uses topupRequiredMessage when activation_required carries only PAYG plans', () => {
    const content: PaywallStructuredContent = {
      kind: 'activation_required',
      product: baseProduct,
      checkoutUrl: '',
      message: 'Call the `topup` tool to add credits.',
      plans: [
        {
          reference: 'pln_payg',
          type: 'usage-based',
          price: 0,
          currency: 'usd',
          requiresPayment: true,
        },
      ],
      productDetails: { name: 'Chat API', reference: baseProduct },
    }
    render(
      <PaywallNotice.Root content={content}>
        <PaywallNotice.Message data-testid="message" />
      </PaywallNotice.Root>,
    )
    const text = screen.getByTestId('message').textContent ?? ''
    expect(text).toMatch(/out of credits/i)
    expect(text).not.toMatch(/\btool\b/i)
    expect(text).toContain('Chat API')
  })

  it('uses activationRequiredMessage when activation_required carries a non-PAYG plan', () => {
    const content: PaywallStructuredContent = {
      kind: 'activation_required',
      product: baseProduct,
      checkoutUrl: '',
      message: 'Activate to continue.',
      plans: [
        {
          reference: 'pln_pro',
          type: 'recurring',
          price: 1900,
          currency: 'usd',
          requiresPayment: true,
          billingCycle: 'monthly',
        },
      ],
    }
    render(
      <PaywallNotice.Root content={content}>
        <PaywallNotice.Message data-testid="message" />
      </PaywallNotice.Root>,
    )
    const text = screen.getByTestId('message').textContent ?? ''
    expect(text).toMatch(/active plan/i)
    expect(text).toMatch(/to continue/i)
    expect(text).not.toMatch(/out of credits/i)
  })
})

describe('PaywallNotice.Heading', () => {
  it('renders activationRequiredHeading for non-PAYG activation gates', () => {
    const content: PaywallStructuredContent = {
      kind: 'activation_required',
      product: baseProduct,
      checkoutUrl: '',
      message: 'Activate to continue.',
      plans: [
        {
          reference: 'pln_pro',
          type: 'recurring',
          price: 1900,
          currency: 'usd',
          requiresPayment: true,
          billingCycle: 'monthly',
        },
      ],
    }
    render(
      <PaywallNotice.Root content={content}>
        <PaywallNotice.Heading data-testid="heading" />
      </PaywallNotice.Root>,
    )
    const text = screen.getByTestId('heading').textContent ?? ''
    expect(text).toBe('Activate a plan to continue')
  })

  it('renders topupRequiredHeading when every gate plan is PAYG', () => {
    const content: PaywallStructuredContent = {
      kind: 'activation_required',
      product: baseProduct,
      checkoutUrl: '',
      message: 'Add credits to continue.',
      plans: [
        {
          reference: 'pln_payg',
          type: 'usage-based',
          price: 0,
          currency: 'usd',
          requiresPayment: true,
        },
      ],
    }
    render(
      <PaywallNotice.Root content={content}>
        <PaywallNotice.Heading data-testid="heading" />
      </PaywallNotice.Root>,
    )
    const text = screen.getByTestId('heading').textContent ?? ''
    expect(text).toBe('Add credits to continue')
  })

  it('renders paymentRequiredHeading for payment_required gates', () => {
    const content: PaywallStructuredContent = {
      kind: 'payment_required',
      product: baseProduct,
      checkoutUrl: '',
      message: 'Upgrade.',
    }
    render(
      <PaywallNotice.Root content={content}>
        <PaywallNotice.Heading data-testid="heading" />
      </PaywallNotice.Root>,
    )
    const text = screen.getByTestId('heading').textContent ?? ''
    expect(text).toBe('Upgrade to continue')
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

  it('renders the stepped checkout with a Free-hiding filter', () => {
    currentSelectedPlan = null
    renderWithProvider(
      <PaywallNotice.Root content={content}>
        <PaywallNotice.EmbeddedCheckout returnUrl="https://example.test/r" />
      </PaywallNotice.Root>,
    )
    const selector = screen.getByTestId('plan-selector-root')
    expect(selector.getAttribute('data-has-filter')).toBe('true')
    expect(selector.getAttribute('data-filter-hides-free')).toBe('true')
  })

  it("doesn't mount Payment / Topup / AmountPicker on the plan step (stepped composition)", () => {
    currentSelectedPlan = {
      reference: 'pln_payg',
      type: 'usage-based',
      currency: 'sek',
      requiresPayment: true,
    }
    renderWithProvider(
      <PaywallNotice.Root content={content}>
        <PaywallNotice.EmbeddedCheckout returnUrl="https://example.test/r" />
      </PaywallNotice.Root>,
    )
    expect(screen.queryByTestId('amount-picker-root')).toBeNull()
    expect(screen.queryByTestId('payment-form-root')).toBeNull()
    expect(screen.queryByTestId('topup-form-root')).toBeNull()
  })

  it('renders nothing when the paywall content has no product', () => {
    const noProduct = {
      ...content,
      product: '',
    }
    renderWithProvider(
      <PaywallNotice.Root content={noProduct}>
        <PaywallNotice.EmbeddedCheckout returnUrl="https://example.test/r" />
      </PaywallNotice.Root>,
    )
    expect(screen.queryByTestId('plan-selector-root')).toBeNull()
  })
})
