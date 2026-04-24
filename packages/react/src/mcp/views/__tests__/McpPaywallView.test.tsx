/**
 * Integration coverage for `<McpPaywallView>` — asserts the paywall
 * now mounts the shared checkout state machine, so PAYG selection no
 * longer renders an inline amount picker next to the plan grid.
 *
 * Instead the flow is plan → Continue → amount → Continue → payment,
 * exactly matching `<McpCheckoutView>`'s `activate_plan` path.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Stub Stripe-bound primitives — identical pattern to McpCheckoutView's test.
vi.mock('../../../primitives/TopupForm', () => {
  const Root: React.FC<{
    amount: number
    currency?: string
    returnUrl?: string
    onSuccess?: () => void
    className?: string
    children?: React.ReactNode
  }> = ({ onSuccess, children }) => (
    <div data-testid="topup-form-stub">
      <button
        type="button"
        data-testid="topup-form-submit"
        onClick={() => onSuccess?.()}
      >
        submit topup
      </button>
      {children}
    </div>
  )
  const Loading: React.FC = () => null
  const PaymentElement: React.FC = () => <div data-testid="topup-payment-element" />
  const ErrorSlot: React.FC = () => null
  const SubmitButton: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
    <span data-testid="topup-submit-label">{children}</span>
  )
  return {
    TopupForm: { Root, Loading, PaymentElement, Error: ErrorSlot, SubmitButton },
  }
})

vi.mock('../../../primitives/PaymentForm', () => {
  const Root: React.FC<{
    planRef: string
    productRef: string
    returnUrl?: string
    onSuccess?: (intent: { id: string }) => void
    children?: React.ReactNode
  }> = ({ onSuccess, children }) => (
    <div data-testid="payment-form-stub">
      <button
        type="button"
        data-testid="payment-form-submit"
        onClick={() => onSuccess?.({ id: 'pi_test' })}
      >
        submit payment
      </button>
      {children}
    </div>
  )
  const Loading: React.FC = () => null
  const PaymentElement: React.FC = () => <div data-testid="payment-element" />
  const ErrorSlot: React.FC = () => null
  const Summary: React.FC = () => null
  const MandateText: React.FC = () => null
  const SubmitButton: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
    <span data-testid="payment-submit-label">{children}</span>
  )
  return {
    PaymentForm: {
      Root,
      Loading,
      PaymentElement,
      Error: ErrorSlot,
      Summary,
      MandateText,
      SubmitButton,
    },
  }
})

vi.mock('../../useStripeProbe', () => ({
  useStripeProbe: () => 'ready',
}))

// Imports AFTER mocks so the test exercises the real state machine.
import { McpPaywallView } from '../McpPaywallView'
import { plansCache } from '../../../hooks/usePlans'
import { merchantCache } from '../../../hooks/useMerchant'
import { SolvaPayContext } from '../../../SolvaPayProvider'
import type { PaywallStructuredContent } from '@solvapay/server'
import type {
  Plan,
  SolvaPayConfig,
  SolvaPayContextValue,
} from '../../../types'

const productRef = 'prd_test'

const freePlan: Plan = {
  reference: 'pln_free',
  name: 'Free',
  price: 0,
  currency: 'usd',
  requiresPayment: false,
  type: 'one-time',
}

const paygPlan: Plan = {
  reference: 'pln_payg',
  name: 'Pay as you go',
  price: 1,
  currency: 'usd',
  requiresPayment: true,
  type: 'usage-based',
  creditsPerUnit: 1,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...({ planType: 'usage-based' } as any),
}

const proPlan: Plan = {
  reference: 'pln_pro',
  name: 'Pro',
  price: 1800,
  currency: 'usd',
  requiresPayment: true,
  type: 'recurring',
  billingCycle: 'monthly',
  creditsPerUnit: 0,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...({ planType: 'recurring' } as any),
}

const bootstrapPlans = [
  { ...freePlan, planType: 'free' },
  { ...paygPlan, planType: 'usage-based' },
  { ...proPlan, planType: 'recurring' },
] as const

function makeTransport(
  overrides: Partial<NonNullable<SolvaPayConfig['transport']>> = {},
): NonNullable<SolvaPayConfig['transport']> {
  return {
    checkPurchase: vi.fn().mockResolvedValue({ purchases: [] }),
    createPayment: vi.fn(),
    processPayment: vi.fn(),
    createTopupPayment: vi.fn(),
    getBalance: vi.fn(),
    cancelRenewal: vi.fn(),
    reactivateRenewal: vi.fn(),
    activatePlan: vi.fn().mockResolvedValue({ status: 'activated' }),
    createCheckoutSession: vi.fn(),
    createCustomerSession: vi.fn(),
    getMerchant: vi.fn(),
    getProduct: vi.fn(),
    listPlans: vi.fn().mockResolvedValue([freePlan, paygPlan, proPlan]),
    getPaymentMethod: vi.fn().mockResolvedValue({ kind: 'none' }),
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

function buildCtx(config: SolvaPayConfig): SolvaPayContextValue {
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
      email: 'demo@acme.test',
      name: 'Demo',
    },
    refetchPurchase: vi.fn(),
    createPayment: vi.fn(),
    createTopupPayment: vi.fn(),
    cancelRenewal: vi.fn(),
    reactivateRenewal: vi.fn(),
    activatePlan: vi.fn().mockResolvedValue({ status: 'activated' }),
    balance: {
      loading: false,
      credits: 0,
      displayCurrency: 'USD',
      creditsPerMinorUnit: 100,
      displayExchangeRate: 1,
      refetch: vi.fn(),
      adjustBalance: vi.fn(),
    },
    _config: config,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

function renderPaywall(
  overrides: Partial<React.ComponentProps<typeof McpPaywallView>> = {},
) {
  const transport = makeTransport()
  const config: SolvaPayConfig = { transport }
  const ctx = buildCtx(config)
  plansCache.set(productRef, {
    plans: [freePlan, paygPlan, proPlan],
    timestamp: Date.now(),
    promise: null,
  })
  const content: PaywallStructuredContent = {
    kind: 'payment_required',
    product: productRef,
    checkoutUrl: 'https://example.test/c',
    message: "You've used all your included calls. Pick a plan below.",
  }
  return {
    ctx,
    transport,
    ...render(
      <SolvaPayContext.Provider value={ctx}>
        <McpPaywallView
          content={content}
          publishableKey="pk_test"
          returnUrl="https://example.test/r"
          plans={bootstrapPlans}
          {...overrides}
        />
      </SolvaPayContext.Provider>,
    ),
  }
}

beforeEach(() => {
  plansCache.clear()
  merchantCache.clear()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('<McpPaywallView> — stepped flow parity with McpCheckoutView', () => {
  it('renders a plan grid with Free hidden and a Continue CTA (not an inline amount picker)', async () => {
    renderPaywall()
    await waitFor(() => {
      expect(screen.getByText('Pay as you go')).toBeTruthy()
      expect(screen.getByText('Pro')).toBeTruthy()
    })
    // Free card must not render — paywall only surfaces paid plans.
    expect(screen.queryByText(/^Free$/)).toBeNull()
    // Continue CTA is present and tracks the selected plan.
    expect(
      screen.getByRole('button', { name: /Continue with Pay as you go/ }),
    ).toBeTruthy()
    // Critical: the broken inline amount picker must NOT render on
    // the plan step. "How many credits?" is the amount-step heading.
    expect(screen.queryByText(/How many credits/)).toBeNull()
    // No TopupForm or PaymentForm on the plan step either.
    expect(screen.queryByTestId('topup-form-stub')).toBeNull()
    expect(screen.queryByTestId('payment-form-stub')).toBeNull()
  })

  it('advances to the amount step only after Continue is clicked (no activate_plan yet)', async () => {
    const { transport } = renderPaywall()
    await waitFor(() =>
      screen.getByRole('button', { name: /Continue with Pay as you go/ }),
    )
    act(() => {
      fireEvent.click(
        screen.getByRole('button', { name: /Continue with Pay as you go/ }),
      )
    })
    // Amount step heading appears, plan grid disappears.
    await waitFor(() => expect(screen.getByText(/How many credits/)).toBeTruthy())
    expect(screen.queryByText(/Choose a plan/)).toBeNull()
    // activate_plan only fires after an amount is confirmed, not on
    // the plan → amount transition.
    expect(transport.activatePlan).not.toHaveBeenCalled()
  })

  it('fires activate_plan on amount confirm and lands on the TopupForm step', async () => {
    const { transport } = renderPaywall()
    await waitFor(() =>
      screen.getByRole('button', { name: /Continue with Pay as you go/ }),
    )
    act(() => {
      fireEvent.click(
        screen.getByRole('button', { name: /Continue with Pay as you go/ }),
      )
    })
    await waitFor(() => screen.getByText(/How many credits/))

    const customInput = screen.getByPlaceholderText('or custom amount')
    act(() => {
      fireEvent.change(customInput, { target: { value: '18' } })
    })

    // After the Retry removal, only the AmountPicker.Confirm
    // `Continue` button remains on this step.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Continue/i }))
    })

    await waitFor(() => {
      expect(transport.activatePlan).toHaveBeenCalledWith({
        productRef,
        planRef: 'pln_payg',
      })
    })
    await waitFor(() => expect(screen.getByTestId('topup-form-stub')).toBeTruthy())
  })

  it('recurring plan skips the amount step and goes straight to PaymentForm', async () => {
    const { transport } = renderPaywall()
    await waitFor(() => screen.getByText('Pro'))
    const proCard = screen
      .getByText('Pro')
      .closest('[data-solvapay-plan-selector-card]') as HTMLElement
    act(() => {
      fireEvent.click(proCard)
    })
    await waitFor(() =>
      screen.getByRole('button', { name: /Continue with Pro/ }),
    )
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Continue with Pro/ }))
    })
    await waitFor(() => expect(screen.getByTestId('payment-form-stub')).toBeTruthy())
    expect(screen.queryByText(/How many credits/)).toBeNull()
    expect(transport.activatePlan).not.toHaveBeenCalled()
  })

  it('renders the PaywallNotice heading + message as the single source of paywall reason copy', async () => {
    const { container } = renderPaywall()
    await waitFor(() => screen.getByText('Pay as you go'))

    // The outer `PaywallNotice.Heading` renders "Upgrade to continue"
    // exactly once — the inline `UpgradeBanner` on the PlanStep is
    // suppressed via `hideUpgradeBanner` so customers don't see
    // duplicated copy.
    expect(screen.getAllByText(/Upgrade to continue/).length).toBe(1)
    expect(
      container.querySelector('[data-solvapay-mcp-checkout-banner]'),
    ).toBeNull()

    // Server-provided message is still echoed by PaywallNotice.Message.
    expect(screen.getByText(/used all your included calls/i)).toBeTruthy()
  })

  it('does not render the PaywallNotice.Retry button — the PlanStep CTA is the only continue affordance', async () => {
    const { container } = renderPaywall()
    await waitFor(() => screen.getByText('Pay as you go'))
    expect(
      container.querySelector('[data-solvapay-paywall-retry]'),
    ).toBeNull()
    // Exactly one `Continue with Pay as you go` CTA, from PlanStep.
    expect(
      screen.getAllByRole('button', { name: /Continue with Pay as you go/ }),
    ).toHaveLength(1)
  })

  it('renders exactly one card (EmbeddedCheckout owns the single card; no outer paywall card)', async () => {
    const { container } = renderPaywall()
    await waitFor(() => screen.getByText('Pay as you go'))
    const cards = container.querySelectorAll('.solvapay-mcp-card')
    expect(cards).toHaveLength(1)
  })

  it('drops PaywallNotice.ProductContext — ShellHeader above the view carries the product name', async () => {
    const { container } = renderPaywall()
    await waitFor(() => screen.getByText('Pay as you go'))
    expect(
      container.querySelector('[data-solvapay-paywall-product-context]'),
    ).toBeNull()
  })
})
