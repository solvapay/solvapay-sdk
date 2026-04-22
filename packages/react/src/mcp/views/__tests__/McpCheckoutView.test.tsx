/**
 * State-machine coverage for `McpCheckoutView` — the paid-plan
 * activation surface.
 *
 * Covers every row in the brief's §7 transition table plus the
 * branch-specific tool wiring (§6), banner gating (§6), CTA label
 * tracking (§3), and both dismissal paths (§4 / §7). Stripe Elements
 * primitives (`TopupForm.Root`, `PaymentForm.Root`) are stubbed so
 * the state machine can be exercised without mounting real Stripe
 * iframes — Stripe-integration tests live alongside those primitives.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ------------------------------------------------------------------
// Primitive stubs — keep the view's state machine testable without
// mounting real Stripe Elements. The stubs simulate success when the
// user clicks the submit button.
// ------------------------------------------------------------------

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
  const Loading: React.FC<{ children?: React.ReactNode }> = () => null
  const PaymentElement: React.FC = () => <div data-testid="topup-payment-element" />
  const ErrorSlot: React.FC<{ children?: React.ReactNode }> = () => null
  const SubmitButton: React.FC<{ children?: React.ReactNode; className?: string }> = ({
    children,
  }) => <span data-testid="topup-submit-label">{children}</span>
  return {
    TopupForm: {
      Root,
      Loading,
      PaymentElement,
      Error: ErrorSlot,
      SubmitButton,
    },
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
  const SubmitButton: React.FC<{ children?: React.ReactNode; className?: string }> = ({
    children,
  }) => <span data-testid="payment-submit-label">{children}</span>
  return {
    PaymentForm: {
      Root,
      Loading,
      PaymentElement,
      Error: ErrorSlot,
      SubmitButton,
    },
  }
})

vi.mock('../../useStripeProbe', () => ({
  useStripeProbe: () => 'ready',
}))

// ------------------------------------------------------------------
// Module imports — defer until after mocks are registered.
// ------------------------------------------------------------------

import { McpCheckoutView } from '../McpCheckoutView'
import { plansCache } from '../../../hooks/usePlans'
import { merchantCache } from '../../../hooks/useMerchant'
import { SolvaPayContext } from '../../../SolvaPayProvider'
import type {
  Plan,
  PurchaseInfo,
  SolvaPayConfig,
  SolvaPayContextValue,
} from '../../../types'

// ------------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------------

const freePlan: Plan = {
  reference: 'pln_free',
  name: 'Free',
  price: 0,
  currency: 'usd',
  requiresPayment: false,
  type: 'one-time',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...({ planType: 'free' } as any),
}

const paygPlan: Plan = {
  reference: 'pln_payg',
  name: 'Pay as you go',
  price: 1, // $0.01 / call
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
  price: 1800, // $18.00
  currency: 'usd',
  requiresPayment: true,
  type: 'recurring',
  billingCycle: 'monthly',
  creditsPerUnit: 0,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...({ planType: 'recurring' } as any),
}

// Bootstrap-shaped plans for the `plans` prop threaded into
// `McpCheckoutView` by the shell.
const bootstrapPlans = [
  // Intentionally includes the Free plan to exercise the filter.
  { ...freePlan, planType: 'free' } as unknown as {
    reference: string
    name: string
    type: string
    planType: string
    price: number
    currency: string
    requiresPayment: boolean
  },
  { ...paygPlan, planType: 'usage-based' } as never,
  { ...proPlan, planType: 'recurring' } as never,
]

const productRef = 'prd_test'

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

function buildCtx(
  config: SolvaPayConfig,
  purchases: PurchaseInfo[] = [],
): SolvaPayContextValue {
  const active = purchases.find((p) => p.status === 'active') ?? null
  return {
    purchase: {
      loading: false,
      isRefetching: false,
      error: null,
      purchases,
      hasProduct: () => purchases.length > 0,
      activePurchase: active,
      hasPaidPurchase: !!active && (active.amount ?? 0) > 0,
      activePaidPurchase: active,
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

function renderView(props: Partial<React.ComponentProps<typeof McpCheckoutView>> = {}) {
  const transport = props.publishableKey
    ? makeTransport()
    : makeTransport({
        // default: resolved list for PlanSelector's fetch fallback
      })
  const config: SolvaPayConfig = { transport }
  const ctx = buildCtx(config)
  // Seed the plans cache so `PlanSelector` renders cards synchronously.
  plansCache.set(productRef, {
    plans: [freePlan, paygPlan, proPlan],
    timestamp: Date.now(),
    promise: null,
  })
  return {
    ctx,
    transport,
    ...render(
      <SolvaPayContext.Provider value={ctx}>
        <McpCheckoutView
          productRef={productRef}
          publishableKey="pk_test"
          returnUrl="https://example.test/r"
          plans={bootstrapPlans}
          {...props}
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

// ------------------------------------------------------------------
// Plan-selection surface
// ------------------------------------------------------------------

describe('<McpCheckoutView> — plan step', () => {
  it('renders the amber "Upgrade to continue" banner when fromPaywall is true', () => {
    renderView({ fromPaywall: true, paywallKind: 'activation_required' })
    expect(screen.getByText(/Upgrade to continue/)).toBeTruthy()
    expect(screen.getByText(/This tool needs a paid plan/)).toBeTruthy()
  })

  it('shows the quota-exhausted copy for paywallKind=payment_required', () => {
    renderView({ fromPaywall: true, paywallKind: 'payment_required' })
    expect(screen.getByText(/used your free quota/i)).toBeTruthy()
  })

  it('does not render the banner or Stay-on-Free link when fromPaywall is false', () => {
    renderView({ fromPaywall: false, onClose: vi.fn() })
    expect(screen.queryByText(/Upgrade to continue/)).toBeNull()
    expect(screen.queryByText(/Stay on Free/)).toBeNull()
  })

  it('hides the Free plan card on the selection surface', async () => {
    renderView({ fromPaywall: true })
    await waitFor(() => {
      // PAYG + Pro render by name
      expect(screen.getByText('Pay as you go')).toBeTruthy()
      expect(screen.getByText('Pro')).toBeTruthy()
    })
    // "Free" would appear as the card name; ensure it's absent.
    expect(screen.queryByText(/^Free$/)).toBeNull()
  })

  it("CTA label tracks the selected plan", async () => {
    renderView({ fromPaywall: true })
    // PAYG is auto-selected via popularPlanRef + autoSelectFirstPaid.
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Continue with Pay as you go/ }),
      ).toBeTruthy()
    })
    // Select Pro → CTA updates.
    const proCard = screen.getByText('Pro').closest('[data-solvapay-plan-selector-card]')
    expect(proCard).toBeTruthy()
    act(() => {
      fireEvent.click(proCard!)
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Continue with Pro/ })).toBeTruthy()
    })
  })

  it('renders the Stay on Free link only when fromPaywall and onClose are both set', () => {
    renderView({ fromPaywall: true, onClose: vi.fn() })
    expect(screen.getByText('Stay on Free')).toBeTruthy()
  })

  it('"Stay on Free" click calls onClose without firing activatePlan', async () => {
    const onClose = vi.fn()
    const { transport } = renderView({ fromPaywall: true, onClose })
    act(() => {
      fireEvent.click(screen.getByText('Stay on Free'))
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(transport.activatePlan).not.toHaveBeenCalled()
  })
})

// ------------------------------------------------------------------
// PAYG branch — plan → amount → payment → success
// ------------------------------------------------------------------

describe('<McpCheckoutView> — PAYG branch', () => {
  it('transitions plan → amount on Continue (no tool call yet)', async () => {
    const { transport } = renderView({ fromPaywall: true })
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Continue with Pay as you go/ }),
      ).toBeTruthy()
    })
    act(() => {
      fireEvent.click(
        screen.getByRole('button', { name: /Continue with Pay as you go/ }),
      )
    })
    expect(screen.getByText(/How many credits/)).toBeTruthy()
    expect(transport.activatePlan).not.toHaveBeenCalled()
    expect(transport.createTopupPayment).not.toHaveBeenCalled()
  })

  it('fires activate_plan on amount → payment transition', async () => {
    const activate = vi.fn().mockResolvedValue({ status: 'activated' })
    const { transport } = renderView({
      fromPaywall: true,
      publishableKey: 'pk_test',
    })
    // Replace activatePlan on the existing transport (buildCtx froze it).
    ;(transport as unknown as { activatePlan: typeof activate }).activatePlan = activate

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Continue with Pay as you go/ }),
      ).toBeTruthy()
    })
    act(() => {
      fireEvent.click(
        screen.getByRole('button', { name: /Continue with Pay as you go/ }),
      )
    })

    // Pick 2 000 credits — the popular preset.
    const presets = screen.getAllByRole('button', { name: /\$/ })
    const twoK = presets.find((el) => el.getAttribute('data-amount'))
    expect(twoK).toBeTruthy()

    // Type a custom amount instead — keeps the test robust against
    // AmountPicker quick-amount default behaviour.
    const customInput = screen.getByPlaceholderText('or custom amount')
    act(() => {
      fireEvent.change(customInput, { target: { value: '18' } })
    })

    const continueBtn = screen.getByRole('button', { name: /Continue/i })
    await act(async () => {
      fireEvent.click(continueBtn)
    })

    await waitFor(() => {
      expect(activate).toHaveBeenCalledWith({
        productRef,
        planRef: 'pln_payg',
      })
    })
    // After activation the view transitions to the payment step.
    await waitFor(() => {
      expect(screen.getByTestId('topup-form-stub')).toBeTruthy()
    })
  })

  it('BackLink returns from amount to plan and clears any activation error', async () => {
    renderView({ fromPaywall: true })
    await waitFor(() =>
      screen.getByRole('button', { name: /Continue with Pay as you go/ }),
    )
    act(() => {
      fireEvent.click(
        screen.getByRole('button', { name: /Continue with Pay as you go/ }),
      )
    })
    expect(screen.getByText(/How many credits/)).toBeTruthy()
    // BackLink's arrow glyph is aria-hidden, so the accessible name is
    // just "Back" (not "← Back"). Anchor the match so "Back to chat"
    // or any other Back-* button doesn't false-match.
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /^Back$/ }))
    })
    await waitFor(() =>
      screen.getByRole('button', { name: /Continue with Pay as you go/ }),
    )
  })

  it('BackLink on PAYG payment step returns to amount (does not re-fire activatePlan)', async () => {
    const { transport } = renderView({ fromPaywall: true })
    await waitFor(() =>
      screen.getByRole('button', { name: /Continue with Pay as you go/ }),
    )
    act(() => {
      fireEvent.click(
        screen.getByRole('button', { name: /Continue with Pay as you go/ }),
      )
    })
    const customInput = screen.getByPlaceholderText('or custom amount')
    act(() => {
      fireEvent.change(customInput, { target: { value: '18' } })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Continue/i }))
    })
    await waitFor(() => expect(screen.getByTestId('topup-form-stub')).toBeTruthy())
    expect(transport.activatePlan).toHaveBeenCalledTimes(1)

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Change amount/ }))
    })
    expect(screen.getByText(/How many credits/)).toBeTruthy()
    expect(transport.activatePlan).toHaveBeenCalledTimes(1) // unchanged
  })

  it('success step renders the PAYG receipt and "Back to chat" calls refresh then close', async () => {
    const onRefreshBootstrap = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    renderView({ fromPaywall: true, onRefreshBootstrap, onClose })
    await waitFor(() =>
      screen.getByRole('button', { name: /Continue with Pay as you go/ }),
    )
    act(() => {
      fireEvent.click(
        screen.getByRole('button', { name: /Continue with Pay as you go/ }),
      )
    })
    act(() => {
      fireEvent.change(screen.getByPlaceholderText('or custom amount'), {
        target: { value: '18' },
      })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Continue/i }))
    })
    await waitFor(() => screen.getByTestId('topup-form-stub'))

    // Simulate Stripe success via the stub.
    await act(async () => {
      fireEvent.click(screen.getByTestId('topup-form-submit'))
    })

    await waitFor(() => screen.getByText(/Credits added/))
    expect(screen.getByText(/Pay as you go plan is active/)).toBeTruthy()
    // Receipt rows.
    expect(screen.getByText('Amount')).toBeTruthy()
    expect(screen.getByText('Credits')).toBeTruthy()
    expect(screen.getByText('Plan')).toBeTruthy()
    expect(screen.getByText('Rate')).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Back to chat/ }))
    })
    await waitFor(() => {
      expect(onRefreshBootstrap).toHaveBeenCalledTimes(1)
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })
})

// ------------------------------------------------------------------
// Recurring branch — plan → payment → success
// ------------------------------------------------------------------

describe('<McpCheckoutView> — Recurring branch', () => {
  it('skips the amount step and lands on payment directly', async () => {
    const { transport } = renderView({ fromPaywall: true })
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
    // No amount picker appeared.
    expect(screen.queryByText(/How many credits/)).toBeNull()
    // activate_plan does NOT fire for the recurring branch — the
    // subscription intent replaces the active plan server-side.
    expect(transport.activatePlan).not.toHaveBeenCalled()
  })

  it('BackLink on recurring payment step returns to plan', async () => {
    renderView({ fromPaywall: true })
    await waitFor(() => screen.getByText('Pro'))
    const proCard = screen
      .getByText('Pro')
      .closest('[data-solvapay-plan-selector-card]') as HTMLElement
    act(() => {
      fireEvent.click(proCard)
    })
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Continue with Pro/ }))
    })
    await waitFor(() => screen.getByTestId('payment-form-stub'))
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Change plan/ }))
    })
    await waitFor(() => screen.getByText('Choose a plan'))
  })

  it('success step renders the Recurring receipt + /manage_account pointer', async () => {
    const onRefreshBootstrap = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    renderView({ fromPaywall: true, onRefreshBootstrap, onClose })
    await waitFor(() => screen.getByText('Pro'))
    const proCard = screen
      .getByText('Pro')
      .closest('[data-solvapay-plan-selector-card]') as HTMLElement
    act(() => {
      fireEvent.click(proCard)
    })
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Continue with Pro/ }))
    })
    await waitFor(() => screen.getByTestId('payment-form-stub'))

    await act(async () => {
      fireEvent.click(screen.getByTestId('payment-form-submit'))
    })

    await waitFor(() => screen.getByText(/Pro active/))
    expect(screen.getByText(/Manage from/)).toBeTruthy()
    expect(screen.getByText(/manage_account/)).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Back to chat/ }))
    })
    expect(onRefreshBootstrap).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
