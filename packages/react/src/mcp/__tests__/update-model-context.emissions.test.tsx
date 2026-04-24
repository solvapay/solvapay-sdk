/**
 * Phase 1 — outbound `ui/update-model-context` emissions at committed
 * widget milestones.
 *
 * Covers the three milestones the bridge spec explicitly calls out:
 *   1. Plan committed from the picker ("User selected <planName>").
 *   2. Topup amount confirmed ("User confirmed topup of …").
 *   3. Successful activation / payment ("Activated <planName>").
 *
 * The account view's cancel/reactivate wiring goes via the
 * `<CancelPlanButton onCancelled>` prop — covered in its own test file.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'

// ------------------------------------------------------------------
// Primitive stubs — same approach as the checkout view tests so the
// state machine can be exercised without Stripe iframes.
// ------------------------------------------------------------------

vi.mock('../../primitives/TopupForm', () => {
  const Root: React.FC<{
    onSuccess?: () => void
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
  const PaymentElement: React.FC = () => null
  const ErrorSlot: React.FC = () => null
  const SubmitButton: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
    <span data-testid="topup-submit">{children}</span>
  )
  return {
    TopupForm: { Root, Loading, PaymentElement, Error: ErrorSlot, SubmitButton },
  }
})

vi.mock('../../primitives/PaymentForm', () => {
  const Root: React.FC<{
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
  const PaymentElement: React.FC = () => null
  const ErrorSlot: React.FC = () => null
  const SubmitButton: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
    <span>{children}</span>
  )
  return {
    PaymentForm: { Root, Loading, PaymentElement, Error: ErrorSlot, SubmitButton },
  }
})

vi.mock('../useStripeProbe', () => ({ useStripeProbe: () => 'ready' }))

// ------------------------------------------------------------------

import { McpCheckoutView } from '../views/McpCheckoutView'
import { McpTopupView } from '../views/McpTopupView'
import { McpBridgeProvider } from '../bridge'
import { plansCache } from '../../hooks/usePlans'
import { merchantCache } from '../../hooks/useMerchant'
import { SolvaPayContext } from '../../SolvaPayProvider'
import type { Plan, SolvaPayConfig, SolvaPayContextValue } from '../../types'

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

const productRef = 'prd_test'

function makeTransport() {
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

function makeApp() {
  return {
    updateModelContext: vi.fn().mockResolvedValue(undefined),
  }
}

function renderCheckout(
  app: { updateModelContext: ReturnType<typeof vi.fn> },
  props: Partial<React.ComponentProps<typeof McpCheckoutView>> = {},
) {
  const transport = makeTransport()
  const config: SolvaPayConfig = { transport }
  const ctx = buildCtx(config)
  plansCache.set(productRef, {
    plans: [freePlan, paygPlan, proPlan],
    timestamp: Date.now(),
    promise: null,
  })
  return render(
    <SolvaPayContext.Provider value={ctx}>
      <McpBridgeProvider app={app as unknown as Parameters<typeof McpBridgeProvider>[0]['app']}>
        <McpCheckoutView
          productRef={productRef}
          publishableKey="pk_test"
          returnUrl="https://example.test/r"
          plans={[
            { ...freePlan, planType: 'free' } as never,
            { ...paygPlan, planType: 'usage-based' } as never,
            { ...proPlan, planType: 'recurring' } as never,
          ]}
          {...props}
        />
      </McpBridgeProvider>
    </SolvaPayContext.Provider>,
  )
}

beforeEach(() => {
  plansCache.clear()
  merchantCache.clear()
})

afterEach(() => {
  vi.clearAllMocks()
})

// ------------------------------------------------------------------

describe('Phase 1 — McpCheckoutView emits on plan commit', () => {
  it('notifies the host when the user continues from the plan picker', async () => {
    const app = makeApp()
    renderCheckout(app)
    await waitFor(() =>
      screen.getByRole('button', { name: /Continue with Pay as you go/ }),
    )
    act(() => {
      fireEvent.click(
        screen.getByRole('button', { name: /Continue with Pay as you go/ }),
      )
    })
    await waitFor(() => {
      expect(app.updateModelContext).toHaveBeenCalled()
    })
    const firstCall = app.updateModelContext.mock.calls[0][0] as {
      content?: Array<{ type: string; text: string }>
    }
    const text = firstCall.content?.[0]?.text ?? ''
    expect(text).toMatch(/Pay as you go/)
  })
})

describe('Phase 1 — McpCheckoutView emits on successful payment', () => {
  it('notifies the host after the recurring payment succeeds', async () => {
    const app = makeApp()
    renderCheckout(app)
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
    // Clear the plan-commit emit so the assertion targets the success emit.
    app.updateModelContext.mockClear()
    await waitFor(() => screen.getByTestId('payment-form-stub'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('payment-form-submit'))
    })
    await waitFor(() => {
      expect(app.updateModelContext).toHaveBeenCalled()
    })
    const text =
      (app.updateModelContext.mock.calls[0][0] as {
        content?: Array<{ type: string; text: string }>
      }).content?.[0]?.text ?? ''
    expect(text).toMatch(/[Aa]ctivated/)
    expect(text).toMatch(/Pro/)
  })
})

// ------------------------------------------------------------------

describe('Phase 1 — McpTopupView emits on amount commit', () => {
  function renderTopup(app: { updateModelContext: ReturnType<typeof vi.fn> }) {
    const transport = makeTransport()
    const config: SolvaPayConfig = { transport }
    const ctx = buildCtx(config)
    return render(
      <SolvaPayContext.Provider value={ctx}>
        <McpBridgeProvider
          app={app as unknown as Parameters<typeof McpBridgeProvider>[0]['app']}
        >
          <McpTopupView publishableKey="pk_test" returnUrl="https://example.test/r" />
        </McpBridgeProvider>
      </SolvaPayContext.Provider>,
    )
  }

  it('notifies the host after the user confirms a top-up amount', async () => {
    const app = makeApp()
    renderTopup(app)
    await waitFor(() => screen.getByText('Add credits'))
    const customInput = screen.getByPlaceholderText('0.00')
    act(() => {
      fireEvent.change(customInput, { target: { value: '25' } })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Continue/i }))
    })
    await waitFor(() => {
      expect(app.updateModelContext).toHaveBeenCalled()
    })
    const text =
      (app.updateModelContext.mock.calls[0][0] as {
        content?: Array<{ type: string; text: string }>
      }).content?.[0]?.text ?? ''
    expect(text).toMatch(/top.?up/i)
  })
})
