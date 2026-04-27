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
  const MandateText: React.FC = () => <p data-testid="payment-mandate-text" />
  return {
    PaymentForm: {
      Root,
      Loading,
      PaymentElement,
      Error: ErrorSlot,
      SubmitButton,
      MandateText,
    },
  }
})

vi.mock('../../../primitives/MandateText', () => ({
  MandateText: () => <p data-testid="mandate-text" />,
}))

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

  it('hides the Free plan card on the selection surface when no purchase is active', async () => {
    renderView({ fromPaywall: true })
    await waitFor(() => {
      // PAYG + Pro render by name
      expect(screen.getByText('Pay as you go')).toBeTruthy()
      expect(screen.getByText('Pro')).toBeTruthy()
    })
    // "Free" would appear as the card name; ensure it's absent.
    expect(screen.queryByText(/^Free$/)).toBeNull()
  })

  it('shows the current plan as a disabled card with a Current badge — including when it is Free', async () => {
    // Spin up the view with an active Free purchase so the grid has
    // a `currentPlanRef` pointing at the Free plan.
    const transport = makeTransport()
    const config: SolvaPayConfig = { transport }
    const activeFreePurchase = {
      reference: 'pur_free',
      productName: 'Test',
      status: 'active',
      startDate: new Date().toISOString(),
      amount: 0,
      planSnapshot: { reference: 'pln_free', name: 'Free', planType: 'free' },
    } as unknown as PurchaseInfo
    const ctx = buildCtx(config, [activeFreePurchase])
    plansCache.set(productRef, {
      plans: [freePlan, paygPlan, proPlan],
      timestamp: Date.now(),
      promise: null,
    })
    render(
      <SolvaPayContext.Provider value={ctx}>
        <McpCheckoutView
          productRef={productRef}
          publishableKey="pk_test"
          returnUrl="https://example.test/r"
          plans={bootstrapPlans}
          fromPaywall
        />
      </SolvaPayContext.Provider>,
    )

    // The Free card renders with the Current badge + is disabled.
    // Locate it via the unique Current badge rather than the name,
    // which collides with the `Free` price label on the same card.
    await waitFor(() => {
      expect(screen.getByText('Current')).toBeTruthy()
    })
    const freeCard = screen
      .getByText('Current')
      .closest('[data-solvapay-plan-selector-card]') as HTMLButtonElement
    expect(freeCard).toBeTruthy()
    expect(freeCard.getAttribute('data-state')).toBe('current')
    expect(freeCard.getAttribute('aria-disabled')).toBe('true')
    expect(freeCard.disabled).toBe(true)
    expect(freeCard.getAttribute('data-free')).toBe('')

    // PAYG card stays clickable; its selection doesn't leak into the
    // Free card.
    const paygCard = screen
      .getByText('Pay as you go')
      .closest('[data-solvapay-plan-selector-card]') as HTMLButtonElement
    expect(paygCard.getAttribute('data-state')).toBe('selected')

    // Clicking the Free card is a no-op — the continue CTA tracks PAYG.
    act(() => {
      fireEvent.click(freeCard)
    })
    expect(
      screen.getByRole('button', { name: /Continue with Pay as you go/ }),
    ).toBeTruthy()
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
// Back-to-account link — wired by `<McpAppShell>` whenever the shell
// owns surface routing. The link only appears on the plan step.
// ------------------------------------------------------------------

describe('<McpCheckoutView> — back to my account link', () => {
  it('renders the BackLink on the plan step when onBack is wired', () => {
    const onBack = vi.fn()
    renderView({ fromPaywall: true, onBack })
    const link = screen.getByRole('button', { name: /back to my account/i })
    expect(link).toBeTruthy()
    act(() => {
      fireEvent.click(link)
    })
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('does not render the BackLink when onBack is omitted', () => {
    renderView({ fromPaywall: true })
    expect(
      screen.queryByRole('button', { name: /back to my account/i }),
    ).toBeNull()
  })

  it('hides the BackLink once the user advances past the plan step', async () => {
    renderView({ fromPaywall: true, onBack: vi.fn() })
    expect(
      screen.getByRole('button', { name: /back to my account/i }),
    ).toBeTruthy()
    await waitFor(() =>
      screen.getByRole('button', { name: /Continue with Pay as you go/ }),
    )
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /Continue with Pay as you go/ }),
      )
    })
    await waitFor(() => screen.getByText(/How many credits/))
    expect(
      screen.queryByRole('button', { name: /back to my account/i }),
    ).toBeNull()
  })
})

// ------------------------------------------------------------------
// PAYG branch — plan → amount → payment → success
// ------------------------------------------------------------------

describe('<McpCheckoutView> — PAYG branch', () => {
  it('fires activate_plan on plan → amount transition', async () => {
    const activate = vi.fn().mockResolvedValue({ status: 'activated' })
    const { transport } = renderView({ fromPaywall: true })
    ;(transport as unknown as { activatePlan: typeof activate }).activatePlan = activate

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Continue with Pay as you go/ }),
      ).toBeTruthy()
    })
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /Continue with Pay as you go/ }),
      )
    })

    // The plan-step Continue click drives activation; the amount picker
    // renders only after the activate_plan call resolves.
    await waitFor(() => {
      expect(activate).toHaveBeenCalledWith({
        productRef,
        planRef: 'pln_payg',
      })
    })
    await waitFor(() => {
      expect(screen.getByText(/How many credits/)).toBeTruthy()
    })
    expect(transport.createTopupPayment).not.toHaveBeenCalled()
  })

  it('amount → payment does not re-fire activate_plan (activation already happened at plan step)', async () => {
    const { transport } = renderView({
      fromPaywall: true,
      publishableKey: 'pk_test',
    })

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Continue with Pay as you go/ }),
      ).toBeTruthy()
    })
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /Continue with Pay as you go/ }),
      )
    })
    // Wait for the amount step so we know activation completed.
    await waitFor(() => expect(screen.getByText(/How many credits/)).toBeTruthy())
    expect(transport.activatePlan).toHaveBeenCalledTimes(1)

    // Pick an amount and continue to payment.
    const customInput = screen.getByPlaceholderText('or custom amount')
    act(() => {
      fireEvent.change(customInput, { target: { value: '18' } })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Continue/i }))
    })

    await waitFor(() => {
      expect(screen.getByTestId('topup-form-stub')).toBeTruthy()
    })
    // Amount-step Continue is purely a local state transition now — no
    // second activate_plan round-trip.
    expect(transport.activatePlan).toHaveBeenCalledTimes(1)
  })

  it('BackLink returns from amount to plan and clears any activation error', async () => {
    renderView({ fromPaywall: true })
    await waitFor(() =>
      screen.getByRole('button', { name: /Continue with Pay as you go/ }),
    )
    // Plan-step Continue now awaits activate_plan — click needs to flush the
    // async state update before the amount step renders.
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /Continue with Pay as you go/ }),
      )
    })
    await waitFor(() => expect(screen.getByText(/How many credits/)).toBeTruthy())
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
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /Continue with Pay as you go/ }),
      )
    })
    const customInput = await waitFor(() =>
      screen.getByPlaceholderText('or custom amount'),
    )
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
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /Continue with Pay as you go/ }),
      )
    })
    const amountInput = await waitFor(() =>
      screen.getByPlaceholderText('or custom amount'),
    )
    act(() => {
      fireEvent.change(amountInput, {
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

  // Regression — the PAYG order summary and success receipt used to
  // multiply `amountMinor` by `plan.creditsPerUnit` (a usage *debit*
  // rate), producing wildly inflated figures. The correct input is
  // the balance DTO's `creditsPerMinorUnit` (mint rate), matching the
  // canonical formula used across the SDK. With the fixture values
  // `creditsPerMinorUnit = 100`, `displayExchangeRate = 1`, and a
  // $18 custom amount (1800 minor units), both surfaces should show
  // 180,000 credits — not 1800 * plan.creditsPerUnit (=1800 here) or
  // any other product of the debit rate.
  it('PAYG surfaces credit counts via the balance mint rate (creditsPerMinorUnit), not plan.creditsPerUnit', async () => {
    renderView({ fromPaywall: true })
    await waitFor(() =>
      screen.getByRole('button', { name: /Continue with Pay as you go/ }),
    )
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /Continue with Pay as you go/ }),
      )
    })
    const amountInput = await waitFor(() =>
      screen.getByPlaceholderText('or custom amount'),
    )
    act(() => {
      fireEvent.change(amountInput, {
        target: { value: '18' },
      })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Continue/i }))
    })
    await waitFor(() => screen.getByTestId('topup-form-stub'))

    // Order summary: 1800 minor * 100 creditsPerMinorUnit = 180,000.
    expect(screen.getByText(/180[,. ]000 credits/)).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByTestId('topup-form-submit'))
    })
    await waitFor(() => screen.getByText(/Credits added/))

    // Success receipt: same figure, rendered as `+180,000`.
    expect(screen.getByText(/\+180[,. ]000/)).toBeTruthy()
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

// ------------------------------------------------------------------
// CSS hooks — guard the markup classes/attributes that the MCP
// stylesheet hangs rules off. A silent rename here = unstyled view,
// so pin the critical selectors with explicit assertions.
// ------------------------------------------------------------------

describe('<McpCheckoutView> — CSS hooks', () => {
  async function advanceToAmountStep() {
    const utils = renderView({ fromPaywall: true })
    await waitFor(() =>
      screen.getByRole('button', { name: /Continue with Pay as you go/ }),
    )
    act(() => {
      fireEvent.click(
        screen.getByRole('button', { name: /Continue with Pay as you go/ }),
      )
    })
    await waitFor(() => screen.getByText(/How many credits/))
    return utils
  }

  async function advanceToPaygPayment() {
    const utils = await advanceToAmountStep()
    act(() => {
      fireEvent.change(screen.getByPlaceholderText('or custom amount'), {
        target: { value: '18' },
      })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Continue/i }))
    })
    await waitFor(() => screen.getByTestId('topup-form-stub'))
    return utils
  }

  async function advanceToPaygSuccess() {
    const utils = await advanceToPaygPayment()
    await act(async () => {
      fireEvent.click(screen.getByTestId('topup-form-submit'))
    })
    await waitFor(() => screen.getByText(/Credits added/))
    return utils
  }

  it('AmountStep renders exactly 4 preset chips (currency-aware quick amounts)', async () => {
    const { container } = await advanceToAmountStep()
    const options = container.querySelectorAll('.solvapay-mcp-amount-option')
    expect(options).toHaveLength(4)
  })

  it('AmountStep marks the recommended preset with data-popular', async () => {
    const { container } = await advanceToAmountStep()
    const popular = container.querySelectorAll(
      '.solvapay-mcp-amount-option[data-popular]',
    )
    expect(popular).toHaveLength(1)
  })

  it('PaygPaymentStep renders order-summary + save-card CSS hooks', async () => {
    const { container } = await advanceToPaygPayment()
    expect(
      container.querySelector('.solvapay-mcp-checkout-order-summary'),
    ).toBeTruthy()
    expect(
      container.querySelectorAll('.solvapay-mcp-checkout-order-summary-row').length,
    ).toBeGreaterThan(0)
    expect(container.querySelector('.solvapay-mcp-checkout-save-card')).toBeTruthy()
  })

  it('PAYG SuccessStep renders success-check + receipt CSS hooks', async () => {
    const { container } = await advanceToPaygSuccess()
    expect(
      container.querySelector('.solvapay-mcp-checkout-success-check'),
    ).toBeTruthy()
    expect(container.querySelector('.solvapay-mcp-checkout-receipt')).toBeTruthy()
    expect(
      container.querySelectorAll('.solvapay-mcp-checkout-receipt-row').length,
    ).toBeGreaterThan(0)
  })
})
