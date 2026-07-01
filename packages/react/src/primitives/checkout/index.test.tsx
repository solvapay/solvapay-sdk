/**
 * `<CheckoutSteps.*>` parts — focused tests for context wiring and
 * step gating. The full state-machine traversal is exercised by
 * `useCheckoutFlow.test.tsx` and the MCP wrapper integration tests
 * in `mcp/views/__tests__/McpCheckoutView.test.tsx`. This file
 * pins the part-level contract: `<Root>` provides flow context,
 * `<IfStep>` gates by `flow.step`, and the buttons / pickers wire
 * the right transitions onto the flow.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../TopupForm', () => {
  const Root: React.FC<{
    amount: number
    currency?: string
    returnUrl?: string
    onSuccess?: () => void
    children?: React.ReactNode
  }> = ({ onSuccess, children }) => (
    <div data-testid="topup-form-stub">
      <button type="button" data-testid="topup-form-submit" onClick={() => onSuccess?.()}>
        submit
      </button>
      {children}
    </div>
  )
  const Loading: React.FC = () => null
  const PaymentElement: React.FC = () => null
  const ErrorSlot: React.FC = () => null
  const SubmitButton: React.FC<{ children?: React.ReactNode; className?: string }> = ({
    children,
  }) => <span data-testid="topup-submit-label">{children}</span>
  const BusinessDetails = {
    Root: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Toggle: () => null,
    BusinessName: () => null,
    Country: () => null,
    TaxId: () => null,
    Fields: () => null,
  }
  const Summary = {
    Root: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Subtotal: () => null,
    Tax: () => null,
    Total: () => null,
    Rows: () => null,
  }
  return {
    TopupForm: { Root, Loading, PaymentElement, Error: ErrorSlot, SubmitButton, BusinessDetails, Summary },
  }
})

vi.mock('../PaymentForm', () => {
  const Root: React.FC<{
    planRef: string
    productRef: string
    onSuccess?: (intent: { id: string }) => void
    children?: React.ReactNode
  }> = ({ onSuccess, children }) => (
    <div data-testid="payment-form-stub">
      <button
        type="button"
        data-testid="payment-form-submit"
        onClick={() => onSuccess?.({ id: 'pi_test' })}
      >
        submit
      </button>
      {children}
    </div>
  )
  const Loading: React.FC = () => null
  const PaymentElement: React.FC = () => null
  const ErrorSlot: React.FC = () => null
  const MandateText: React.FC = () => null
  const SubmitButton: React.FC<{ children?: React.ReactNode; className?: string }> = ({
    children,
  }) => <span data-testid="payment-submit-label">{children}</span>
  const BusinessDetails = {
    Root: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Toggle: () => null,
    BusinessName: () => null,
    Country: () => null,
    TaxId: () => null,
    Fields: () => null,
  }
  const TaxSummary = {
    Root: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Subtotal: () => null,
    Tax: () => null,
    Total: () => null,
    TaxNote: () => null,
    Rows: () => null,
  }
  return {
    PaymentForm: {
      Root,
      Loading,
      PaymentElement,
      Error: ErrorSlot,
      SubmitButton,
      MandateText,
      BusinessDetails,
      TaxSummary,
    },
  }
})

vi.mock('../MandateText', () => ({
  MandateText: () => null,
}))

// `<PaywallNotice.Root>` calls `usePaywallResolver` which spins up
// transport polling against the real provider. The `<StepHeading>` /
// `<StepMessage>` paywall-context tests don't care about resolution
// state — they only need the PaywallNoticeContext to be populated. Stub
// the resolver to a stable, no-op value so the tests stay hermetic.
vi.mock('../../hooks/usePaywallResolver', () => ({
  usePaywallResolver: () => ({ resolved: false, refetch: () => Promise.resolve() }),
}))

import { CheckoutSteps } from './index'
import { PaywallNotice } from '../PaywallNotice'
import type { PaywallStructuredContent } from '@solvapay/server'
import { plansCache } from '../../hooks/usePlans'
import { merchantCache } from '../../hooks/useMerchant'
import { SolvaPayContext } from '../../SolvaPayProvider'
import { createTransportCacheKey } from '../../transport/cache-key'
import type {
  Merchant,
  Plan,
  PurchaseInfo,
  SolvaPayConfig,
  SolvaPayContextValue,
} from '../../types'

const productRef = 'prd_test'

const paygPlan: Plan = {
  reference: 'pln_payg',
  name: 'Pay as you go',
  price: 1,
  currency: 'usd',
  requiresPayment: true,
  type: 'usage-based',
  creditsPerUnit: 1,
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
}

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
    listPlans: vi.fn().mockResolvedValue([paygPlan, proPlan]),
    getPaymentMethod: vi.fn().mockResolvedValue({ kind: 'none' }),
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

function buildCtx(config: SolvaPayConfig, purchases: PurchaseInfo[] = []): SolvaPayContextValue {
  const active = purchases.find(p => p.status === 'active') ?? null
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
    upsertPurchase: vi.fn(),
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

const defaultMerchant: Merchant = {
  displayName: 'Acme',
  legalName: 'Acme Inc.',
  defaultCurrency: 'usd',
}

function renderWithProvider(
  ui: React.ReactNode,
  opts: {
    transport?: NonNullable<SolvaPayConfig['transport']>
    merchant?: Merchant | null
  } = {},
) {
  const transport = opts.transport ?? makeTransport()
  const config: SolvaPayConfig = { transport }
  const ctx = buildCtx(config)
  plansCache.set(productRef, {
    plans: [paygPlan, proPlan],
    timestamp: Date.now(),
    promise: null,
  })
  // Seed the merchant cache so `useCheckoutFlow.topupCurrency` resolves
  // synchronously. The PAYG/topup branch gates rendering on
  // `topupCurrencyReady`; without a merchant the AmountPicker /
  // PaygPayment render skeletons or null.
  const merchant = opts.merchant === undefined ? defaultMerchant : opts.merchant
  if (merchant) {
    merchantCache.set(createTransportCacheKey(config, '/api/merchant'), {
      merchant,
      promise: null,
      timestamp: Date.now(),
    })
  }
  return {
    transport,
    ...render(<SolvaPayContext.Provider value={ctx}>{ui}</SolvaPayContext.Provider>),
  }
}

beforeEach(() => {
  plansCache.clear()
  merchantCache.clear()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('<CheckoutSteps.Root>', () => {
  it('renders children inside a flow + plan-selector context', () => {
    renderWithProvider(
      <CheckoutSteps.Root productRef={productRef} returnUrl="https://example.test/r">
        <div data-testid="child">child</div>
      </CheckoutSteps.Root>,
    )
    expect(screen.getByTestId('child')).toBeTruthy()
  })
})

// `keepAllPaidPlans` opts out of the new default smart filter (which
// hides PAYG when a non-PAYG paid plan exists on the same product).
// These tests intentionally render PAYG + recurring side-by-side, so
// they pass the legacy "hide free only" filter explicitly.
const keepAllPaidPlans = (plan: Plan) => plan.requiresPayment !== false

describe('<CheckoutSteps.IfStep>', () => {
  it('renders content matching the active step', () => {
    renderWithProvider(
      <CheckoutSteps.Root
        productRef={productRef}
        returnUrl="https://example.test/r"
        filter={keepAllPaidPlans}
      >
        <CheckoutSteps.IfStep step="plan">
          <div data-testid="plan-content">plan</div>
        </CheckoutSteps.IfStep>
        <CheckoutSteps.IfStep step="payment">
          <div data-testid="payment-content">payment</div>
        </CheckoutSteps.IfStep>
      </CheckoutSteps.Root>,
    )
    expect(screen.getByTestId('plan-content')).toBeTruthy()
    expect(screen.queryByTestId('payment-content')).toBeNull()
  })
})

describe('<CheckoutSteps.PlanContinueButton>', () => {
  it('drives advance() — fires activate_plan and switches to amount step on PAYG', async () => {
    const { transport } = renderWithProvider(
      <CheckoutSteps.Root
        productRef={productRef}
        returnUrl="https://example.test/r"
        autoSelectFirstPaid={true}
        filter={keepAllPaidPlans}
      >
        <CheckoutSteps.IfStep step="plan">
          <CheckoutSteps.PlanContinueButton data-testid="continue" />
        </CheckoutSteps.IfStep>
        <CheckoutSteps.IfStep step="amount">
          <div data-testid="amount-content">amount</div>
        </CheckoutSteps.IfStep>
      </CheckoutSteps.Root>,
    )
    const button = await waitFor(() => screen.getByTestId('continue') as HTMLButtonElement)
    expect(button.disabled).toBe(false)
    await act(async () => {
      fireEvent.click(button)
    })
    await waitFor(() => {
      expect(transport.activatePlan).toHaveBeenCalledWith({
        productRef,
        planRef: 'pln_payg',
      })
    })
    await waitFor(() => screen.getByTestId('amount-content'))
  })
})

describe('<CheckoutSteps.BackLink>', () => {
  it('calls flow.back() — moves amount step back to plan', async () => {
    const { transport } = renderWithProvider(
      <CheckoutSteps.Root
        productRef={productRef}
        returnUrl="https://example.test/r"
        autoSelectFirstPaid={true}
        filter={keepAllPaidPlans}
      >
        <CheckoutSteps.IfStep step="plan">
          <CheckoutSteps.PlanContinueButton data-testid="continue" />
          <div data-testid="plan-content">plan</div>
        </CheckoutSteps.IfStep>
        <CheckoutSteps.IfStep step="amount">
          <CheckoutSteps.BackLink data-testid="back" label="Back" />
          <div data-testid="amount-content">amount</div>
        </CheckoutSteps.IfStep>
      </CheckoutSteps.Root>,
    )
    await act(async () => {
      fireEvent.click(screen.getByTestId('continue'))
    })
    await waitFor(() => screen.getByTestId('amount-content'))
    expect(transport.activatePlan).toHaveBeenCalled()
    act(() => {
      fireEvent.click(screen.getByTestId('back'))
    })
    expect(screen.getByTestId('plan-content')).toBeTruthy()
    expect(screen.queryByTestId('amount-content')).toBeNull()
  })
})

describe('<CheckoutSteps.Payment>', () => {
  it('mounts TopupForm when the selected plan is PAYG', async () => {
    renderWithProvider(
      <CheckoutSteps.Root
        productRef={productRef}
        returnUrl="https://example.test/r"
        autoSelectFirstPaid={true}
        initialStep="payment"
        initialAmountMinor={1800}
        filter={keepAllPaidPlans}
      >
        <CheckoutSteps.Payment />
      </CheckoutSteps.Root>,
    )
    await waitFor(() => expect(screen.getByTestId('topup-form-stub')).toBeTruthy())
    expect(screen.queryByTestId('payment-form-stub')).toBeNull()
  })

  it('mounts PaymentForm when the selected plan is recurring', async () => {
    renderWithProvider(
      <CheckoutSteps.Root
        productRef={productRef}
        returnUrl="https://example.test/r"
        initialPlanRef="pln_pro"
        initialStep="payment"
        filter={keepAllPaidPlans}
      >
        <CheckoutSteps.Payment />
      </CheckoutSteps.Root>,
    )
    await waitFor(() => expect(screen.getByTestId('payment-form-stub')).toBeTruthy())
    expect(screen.queryByTestId('topup-form-stub')).toBeNull()
  })
})

describe('<CheckoutSteps.Success>', () => {
  it('renders nothing while step is not success', () => {
    renderWithProvider(
      <CheckoutSteps.Root productRef={productRef} returnUrl="https://example.test/r">
        <CheckoutSteps.Success />
      </CheckoutSteps.Root>,
    )
    expect(screen.queryByText(/Credits added/)).toBeNull()
    expect(screen.queryByText(/active/)).toBeNull()
  })
})

describe('default plan filter', () => {
  // Aligns the SDK with the hosted-checkout topup pattern: a topup
  // product needs only one usage-based plan + AmountPicker. Pack plans
  // alongside PAYG are an antipattern; when they do exist (legacy /
  // mixed configs), PAYG drops out so the grid renders only the packs.
  const pack100: Plan = {
    reference: 'pln_pack_100',
    name: '100 Credits',
    price: 500,
    currency: 'usd',
    requiresPayment: true,
    type: 'one-time',
    creditsPerUnit: 0,
  }
  const pack250: Plan = {
    reference: 'pln_pack_250',
    name: '250 Credits',
    price: 1000,
    currency: 'usd',
    requiresPayment: true,
    type: 'one-time',
    creditsPerUnit: 0,
  }
  const freePlan: Plan = {
    reference: 'pln_free',
    name: 'Free',
    price: 0,
    currency: 'usd',
    requiresPayment: false,
    type: 'recurring',
    creditsPerUnit: 0,
  }

  function renderWithPlans(plans: Plan[]) {
    const transport = makeTransport({ listPlans: vi.fn().mockResolvedValue(plans) })
    const config: SolvaPayConfig = { transport }
    const ctx = buildCtx(config)
    plansCache.set(productRef, { plans, timestamp: Date.now(), promise: null })
    return render(
      <SolvaPayContext.Provider value={ctx}>
        <CheckoutSteps.Root productRef={productRef} returnUrl="https://example.test/r">
          <CheckoutSteps.IfStep step="plan">
            <CheckoutSteps.PlanGrid />
          </CheckoutSteps.IfStep>
        </CheckoutSteps.Root>
      </SolvaPayContext.Provider>,
    )
  }

  it('hides PAYG when the product also exposes non-PAYG paid plans (legacy topup-with-packs config)', async () => {
    renderWithPlans([freePlan, paygPlan, pack100, pack250])
    await waitFor(() => screen.getByText('100 Credits'))
    expect(screen.getByText('250 Credits')).toBeTruthy()
    expect(screen.queryByText('Pay as you go')).toBeNull()
    expect(screen.queryByText('Free')).toBeNull()
  })

  it('keeps PAYG when it is the only paid option (canonical topup config)', async () => {
    renderWithPlans([freePlan, paygPlan])
    await waitFor(() => screen.getByText('Pay as you go'))
    expect(screen.queryByText('Free')).toBeNull()
  })
})

// ------------------------------------------------------------------
// Phase 0 — PAYG topup currency comes from the merchant (or explicit
// `topupCurrency` prop). Plan currency is never consulted for the
// topup branch. Step components gate on `topupCurrencyReady` so they
// never paint a misleading currency while the merchant fetch is in
// flight.
// ------------------------------------------------------------------

describe('<CheckoutSteps> topup currency', () => {
  it('renders skeleton AmountPicker when merchant is unresolved and no prop is passed', () => {
    renderWithProvider(
      <CheckoutSteps.Root
        productRef={productRef}
        returnUrl="https://example.test/r"
        autoSelectFirstPaid={true}
        initialStep="amount"
      >
        <CheckoutSteps.AmountPicker />
        <CheckoutSteps.AmountContinueButton data-testid="continue" />
      </CheckoutSteps.Root>,
      { merchant: null },
    )
    const picker = document.querySelector('[data-state="loading"]')
    expect(picker).not.toBeNull()
    expect(picker?.getAttribute('aria-busy')).toBe('true')
    const continueButton = screen.getByTestId('continue') as HTMLButtonElement
    expect(continueButton.disabled).toBe(true)
  })

  // Regression: `<CheckoutSteps.AmountPicker>` mounts the picker
  // `Root` internally, so `<CheckoutSteps.AmountContinueButton>` is a
  // *sibling* — not a descendant — of that `Root`. Wrapping the
  // continue button in `<AmountPicker.Confirm>` (which calls
  // `usePickerCtx`) would throw at runtime in this layout. Pin the
  // sibling composition end-to-end: render, click a preset, verify
  // the button enables and advances to the payment step.
  it('AmountContinueButton works when rendered as a sibling of AmountPicker', async () => {
    renderWithProvider(
      <CheckoutSteps.Root
        productRef={productRef}
        returnUrl="https://example.test/r"
        autoSelectFirstPaid={true}
        initialStep="amount"
      >
        <CheckoutSteps.IfStep step="amount">
          <CheckoutSteps.AmountPicker />
          <CheckoutSteps.AmountContinueButton data-testid="continue" />
        </CheckoutSteps.IfStep>
        <CheckoutSteps.IfStep step="payment">
          <div data-testid="payment-content">payment</div>
        </CheckoutSteps.IfStep>
      </CheckoutSteps.Root>,
    )
    const continueButton = await waitFor(
      () => screen.getByTestId('continue') as HTMLButtonElement,
    )
    expect(continueButton.disabled).toBe(true)
    const preset = await waitFor(
      () => document.querySelector('[data-amount="10"]') as HTMLElement | null,
    )
    expect(preset).not.toBeNull()
    act(() => {
      fireEvent.click(preset as HTMLElement)
    })
    await waitFor(() => expect(continueButton.disabled).toBe(false))
    expect(continueButton.textContent).toMatch(/^Continue — /)
    await act(async () => {
      fireEvent.click(continueButton)
    })
    await waitFor(() => screen.getByTestId('payment-content'))
  })

  it('paints the merchant currency on the AmountPicker (no plan-currency leak)', async () => {
    // Merchant settles in SEK; a SEK preset (100) must render — never
    // a USD preset (10) — even though the PAYG fixture carries
    // `currency: 'usd'`.
    renderWithProvider(
      <CheckoutSteps.Root
        productRef={productRef}
        returnUrl="https://example.test/r"
        autoSelectFirstPaid={true}
        initialStep="amount"
      >
        <CheckoutSteps.AmountPicker />
      </CheckoutSteps.Root>,
      {
        merchant: { displayName: 'Acme', legalName: 'Acme', defaultCurrency: 'sek' },
      },
    )
    const sekPreset = await waitFor(
      () => document.querySelector('[data-amount="100"]') as HTMLElement | null,
    )
    expect(sekPreset).not.toBeNull()
    // USD lowest preset is 10; in SEK mode it must not appear.
    expect(document.querySelector('[data-amount="10"]')).toBeNull()
  })

  it('explicit `topupCurrency` prop overrides merchant currency', async () => {
    renderWithProvider(
      <CheckoutSteps.Root
        productRef={productRef}
        returnUrl="https://example.test/r"
        autoSelectFirstPaid={true}
        initialStep="amount"
        topupCurrency="EUR"
      >
        <CheckoutSteps.AmountPicker />
      </CheckoutSteps.Root>,
      {
        merchant: { displayName: 'Acme', legalName: 'Acme', defaultCurrency: 'sek' },
      },
    )
    // EUR uses the same defaults as USD `[10, 50, 100, 500]`. The
    // `data-amount=50` preset is unique to EUR/USD and absent from SEK
    // (`[100, 500, 1000, 5000]`); use it as a tie-breaker so this
    // assertion can't pass against the SEK presets.
    const eurPreset = await waitFor(
      () => document.querySelector('[data-amount="50"]') as HTMLElement | null,
    )
    expect(eurPreset).not.toBeNull()
  })
})

describe('<CheckoutSteps.Payment> recurring vs one-time copy', () => {
  it('renders "Subscribe — $X/mo" for a recurring plan with billingCycle', async () => {
    renderWithProvider(
      <CheckoutSteps.Root
        productRef={productRef}
        returnUrl="https://example.test/r"
        initialPlanRef="pln_pro"
        initialStep="payment"
        filter={keepAllPaidPlans}
      >
        <CheckoutSteps.Payment />
      </CheckoutSteps.Root>,
    )
    await waitFor(() => screen.getByTestId('payment-form-stub'))
    const label = screen.getByTestId('payment-submit-label')
    expect(label.textContent).toMatch(/^Subscribe —/)
    expect(label.textContent).toMatch(/\/mo$/)
  })

  it('renders "Pay $X" (no /cycle suffix) for a one-time plan with no billingCycle', async () => {
    const lifetimePlan: Plan = {
      reference: 'pln_lifetime',
      name: 'Lifetime',
      price: 9900,
      currency: 'usd',
      requiresPayment: true,
      type: 'one-time',
      creditsPerUnit: 0,
    }
    const transport = makeTransport({ listPlans: vi.fn().mockResolvedValue([lifetimePlan]) })
    const config: SolvaPayConfig = { transport }
    const ctx = buildCtx(config)
    plansCache.set(productRef, {
      plans: [lifetimePlan],
      timestamp: Date.now(),
      promise: null,
    })
    merchantCache.set(createTransportCacheKey(config, '/api/merchant'), {
      merchant: defaultMerchant,
      promise: null,
      timestamp: Date.now(),
    })
    render(
      <SolvaPayContext.Provider value={ctx}>
        <CheckoutSteps.Root
          productRef={productRef}
          returnUrl="https://example.test/r"
          initialPlanRef="pln_lifetime"
          initialStep="payment"
        >
          <CheckoutSteps.Payment />
        </CheckoutSteps.Root>
      </SolvaPayContext.Provider>,
    )
    await waitFor(() => screen.getByTestId('payment-form-stub'))
    const label = screen.getByTestId('payment-submit-label')
    expect(label.textContent).toMatch(/^Pay /)
    expect(label.textContent).not.toMatch(/Subscribe/)
    expect(label.textContent).not.toMatch(/\/(mo|yr|wk|d)$/)
  })
})

// ------------------------------------------------------------------
// `<CheckoutSteps.StepHeading>` + `<StepMessage>` — step-aware copy.
// ------------------------------------------------------------------
//
// These primitives drive the heading/subheading at the top of the
// embedded checkout drawer (proactive upgrade path) and the paywall
// surface (`<PaywallNotice.EmbeddedCheckout>`). Pin the matrix so
// integrators can rely on the copy reflecting where the user actually
// is in the flow:
//
//   step       branch     plan billingCycle    paywall context  -> copy
//   plan       —          —                     none             -> "Choose your plan"
//   plan       —          —                     payment_required -> paywall.paymentRequiredHeading
//   plan       —          —                     activation+payg  -> paywall.topupRequiredHeading
//   amount     —          —                     —                -> "Add credits"
//   payment    payg       —                     —                -> "Confirm your card to add credits..."
//   payment    recurring  monthly               —                -> "Confirm your card to start your {planName} plan."
//   payment    recurring  none (one-time)       —                -> "Confirm your card to complete the purchase."
//   success    —          —                     —                -> renders nothing

describe('<CheckoutSteps.StepHeading> / <StepMessage>', () => {
  it('renders "Choose your plan" / plan message at the plan step outside paywall context', async () => {
    renderWithProvider(
      <CheckoutSteps.Root
        productRef={productRef}
        returnUrl="https://example.test/r"
        filter={keepAllPaidPlans}
      >
        <CheckoutSteps.StepHeading data-testid="heading" />
        <CheckoutSteps.StepMessage data-testid="message" />
      </CheckoutSteps.Root>,
    )
    await waitFor(() =>
      expect(screen.getByTestId('heading').textContent).toBe('Choose your plan'),
    )
    expect(screen.getByTestId('message').textContent).toBe(
      'Pick the option that fits your usage.',
    )
    expect(screen.getByTestId('heading').getAttribute('data-step')).toBe('plan')
  })

  it('renders "Add credits" at the amount step', async () => {
    renderWithProvider(
      <CheckoutSteps.Root
        productRef={productRef}
        returnUrl="https://example.test/r"
        autoSelectFirstPaid={true}
        initialStep="amount"
      >
        <CheckoutSteps.StepHeading data-testid="heading" />
        <CheckoutSteps.StepMessage data-testid="message" />
      </CheckoutSteps.Root>,
    )
    await waitFor(() => expect(screen.getByTestId('heading').textContent).toBe('Add credits'))
    expect(screen.getByTestId('message').textContent).toBe(
      'Pick or enter an amount to add to your balance.',
    )
  })

  it('renders "Complete payment" + payg message at the payment step on the PAYG branch', async () => {
    renderWithProvider(
      <CheckoutSteps.Root
        productRef={productRef}
        returnUrl="https://example.test/r"
        initialPlanRef="pln_payg"
        initialAmountMinor={500}
        initialStep="payment"
        filter={keepAllPaidPlans}
      >
        <CheckoutSteps.StepHeading data-testid="heading" />
        <CheckoutSteps.StepMessage data-testid="message" />
      </CheckoutSteps.Root>,
    )
    await waitFor(() =>
      expect(screen.getByTestId('heading').textContent).toBe('Complete payment'),
    )
    expect(screen.getByTestId('message').textContent).toBe(
      'Confirm your card to add credits to your balance.',
    )
  })

  it('interpolates plan name into recurring payment message when billingCycle is set', async () => {
    renderWithProvider(
      <CheckoutSteps.Root
        productRef={productRef}
        returnUrl="https://example.test/r"
        initialPlanRef="pln_pro"
        initialStep="payment"
        filter={keepAllPaidPlans}
      >
        <CheckoutSteps.StepHeading data-testid="heading" />
        <CheckoutSteps.StepMessage data-testid="message" />
      </CheckoutSteps.Root>,
    )
    await waitFor(() =>
      expect(screen.getByTestId('heading').textContent).toBe('Complete payment'),
    )
    expect(screen.getByTestId('message').textContent).toBe(
      'Confirm your card to start your Pro plan.',
    )
  })

  it('renders one-time payment message when the recurring plan has no billingCycle', async () => {
    const lifetimePlan: Plan = {
      reference: 'pln_lifetime',
      name: 'Lifetime',
      price: 9900,
      currency: 'usd',
      requiresPayment: true,
      type: 'one-time',
      creditsPerUnit: 0,
    }
    const transport = makeTransport({ listPlans: vi.fn().mockResolvedValue([lifetimePlan]) })
    const config: SolvaPayConfig = { transport }
    const ctx = buildCtx(config)
    plansCache.set(productRef, {
      plans: [lifetimePlan],
      timestamp: Date.now(),
      promise: null,
    })
    merchantCache.set(createTransportCacheKey(config, '/api/merchant'), {
      merchant: defaultMerchant,
      promise: null,
      timestamp: Date.now(),
    })
    render(
      <SolvaPayContext.Provider value={ctx}>
        <CheckoutSteps.Root
          productRef={productRef}
          returnUrl="https://example.test/r"
          initialPlanRef="pln_lifetime"
          initialStep="payment"
        >
          <CheckoutSteps.StepHeading data-testid="heading" />
          <CheckoutSteps.StepMessage data-testid="message" />
        </CheckoutSteps.Root>
      </SolvaPayContext.Provider>,
    )
    await waitFor(() =>
      expect(screen.getByTestId('heading').textContent).toBe('Complete payment'),
    )
    expect(screen.getByTestId('message').textContent).toBe(
      'Confirm your card to complete the purchase.',
    )
  })

  it('uses paywall gate-reason heading at the plan step inside payment_required paywall', async () => {
    const paywallContent: PaywallStructuredContent = {
      kind: 'payment_required',
      message: 'server-flavored copy',
      product: productRef,
      productDetails: { name: 'Acme API' },
    } as PaywallStructuredContent
    renderWithProvider(
      <PaywallNotice.Root content={paywallContent}>
        <CheckoutSteps.Root
          productRef={productRef}
          returnUrl="https://example.test/r"
          filter={keepAllPaidPlans}
        >
          <CheckoutSteps.StepHeading data-testid="heading" />
          <CheckoutSteps.StepMessage data-testid="message" />
        </CheckoutSteps.Root>
      </PaywallNotice.Root>,
    )
    await waitFor(() =>
      expect(screen.getByTestId('heading').textContent).toBe('Upgrade to continue'),
    )
    // `paymentRequiredMessageNoBalance` interpolates the product
    // suffix; assert the canonical sentence is rendered.
    expect(screen.getByTestId('message').textContent).toContain(
      "You've used your included messages",
    )
    expect(screen.getByTestId('message').textContent).toContain('Acme API')
  })

  it('uses topup gate-reason heading when every paywall plan is PAYG (activation_required)', async () => {
    const paywallContent: PaywallStructuredContent = {
      kind: 'activation_required',
      message: 'server-flavored copy',
      product: productRef,
      plans: [
        // PAYG-only — every plan has a usage-based / hybrid type.
        { reference: 'pln_payg', type: 'usage-based', name: 'PAYG', price: 0, currency: 'usd' },
      ],
    } as unknown as PaywallStructuredContent
    renderWithProvider(
      <PaywallNotice.Root content={paywallContent}>
        <CheckoutSteps.Root
          productRef={productRef}
          returnUrl="https://example.test/r"
          filter={keepAllPaidPlans}
        >
          <CheckoutSteps.StepHeading data-testid="heading" />
          <CheckoutSteps.StepMessage data-testid="message" />
        </CheckoutSteps.Root>
      </PaywallNotice.Root>,
    )
    await waitFor(() =>
      expect(screen.getByTestId('heading').textContent).toBe('Add credits to continue'),
    )
    expect(screen.getByTestId('message').textContent).toContain("You're out of credits")
  })

  it('renders nothing at the success step', async () => {
    // `flow.step` lands on `success` once the payment form reports
    // success; the heading + message are noise once the receipt is on
    // screen, so they unmount.
    renderWithProvider(
      <CheckoutSteps.Root
        productRef={productRef}
        returnUrl="https://example.test/r"
        initialPlanRef="pln_pro"
        initialStep="payment"
        filter={keepAllPaidPlans}
      >
        <CheckoutSteps.StepHeading data-testid="heading" />
        <CheckoutSteps.StepMessage data-testid="message" />
        <CheckoutSteps.Payment />
      </CheckoutSteps.Root>,
    )
    await waitFor(() => screen.getByTestId('payment-form-stub'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('payment-form-submit'))
    })
    await waitFor(() => expect(screen.queryByTestId('heading')).toBeNull())
    expect(screen.queryByTestId('message')).toBeNull()
  })
})
