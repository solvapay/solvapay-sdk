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
  return {
    TopupForm: { Root, Loading, PaymentElement, Error: ErrorSlot, SubmitButton },
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

vi.mock('../MandateText', () => ({
  MandateText: () => null,
}))

import { CheckoutSteps } from './index'
import { plansCache } from '../../hooks/usePlans'
import { merchantCache } from '../../hooks/useMerchant'
import { SolvaPayContext } from '../../SolvaPayProvider'
import type { Plan, PurchaseInfo, SolvaPayConfig, SolvaPayContextValue } from '../../types'

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

function renderWithProvider(
  ui: React.ReactNode,
  opts: { transport?: NonNullable<SolvaPayConfig['transport']> } = {},
) {
  const transport = opts.transport ?? makeTransport()
  const config: SolvaPayConfig = { transport }
  const ctx = buildCtx(config)
  plansCache.set(productRef, {
    plans: [paygPlan, proPlan],
    timestamp: Date.now(),
    promise: null,
  })
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
        <CheckoutSteps.Root
          productRef={productRef}
          returnUrl="https://example.test/r"
          autoSkipSinglePlan={false}
        >
          <CheckoutSteps.IfStep step="plan">
            <CheckoutSteps.PlanGrid />
          </CheckoutSteps.IfStep>
        </CheckoutSteps.Root>
      </SolvaPayContext.Provider>,
    )
  }

  it('hides PAYG when the product also exposes non-PAYG paid plans (legacy topup-with-packs config)', async () => {
    // Two packs so the plan step renders even with `autoSkipSinglePlan` defaults.
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
