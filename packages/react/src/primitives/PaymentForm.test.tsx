/**
 * PaymentForm primitive tests.
 *
 * Focuses on the primitive contract (asChild / data-state / data-variant /
 * Loading + Error / structured errors). Free-plan behavioral coverage
 * (activation path, onFreePlan override, terms gating) lives in
 * `PaymentForm.freePlan.test.tsx`.
 */
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import React from 'react'
import { PaymentForm } from './PaymentForm'
import { SolvaPayProvider, SolvaPayContext } from '../SolvaPayProvider'
import { plansCache } from '../hooks/usePlans'
import { productCache } from '../hooks/useProduct'
import { merchantCache } from '../hooks/useMerchant'
import { MissingProviderError } from '../utils/errors'
import { enCopy } from '../i18n/en'
import type { Plan, SolvaPayContextValue } from '../types'

// ---------- Paid-plan success-branch mocks ----------
//
// The tests below drive the paid branch of <PaymentForm.Root>. They mock
// Stripe Elements + the confirmPayment/reconcilePayment utilities so the
// component hits the post-reconcile polling loop introduced for the MCP
// checkout flicker fix (plan: close_mcp_checkout_success_gap).
//
// These mocks never execute for the free-plan tests above because
// FreeInner doesn't touch Stripe or confirmPayment/reconcilePayment.

vi.mock('@stripe/react-stripe-js', async () => {
  const ReactMod = await import('react')
  return {
    Elements: ({ children }: { children: React.ReactNode }) =>
      ReactMod.createElement('div', { 'data-testid': 'stripe-elements' }, children),
    useStripe: () => ({ confirmPayment: vi.fn(), confirmCardPayment: vi.fn() }),
    useElements: () => ({ getElement: vi.fn(), submit: vi.fn() }),
    CardElement: () => ReactMod.createElement('div', { 'data-testid': 'card-element' }),
    PaymentElement: ({
      onChange,
    }: {
      onChange?: (e: { complete: boolean }) => void
    }) => {
      // Auto-complete the payment element so `canSubmit` becomes true
      // without driving Stripe's real change events.
      ReactMod.useEffect(() => {
        onChange?.({ complete: true })
      }, [onChange])
      return ReactMod.createElement('div', { 'data-testid': 'payment-element' })
    },
  }
})

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(() => Promise.resolve({ confirmPayment: vi.fn() })),
}))

vi.mock('../utils/confirmPayment', () => ({
  confirmPayment: vi.fn().mockResolvedValue({
    status: 'succeeded',
    paymentIntent: { id: 'pi_test_123', status: 'succeeded' },
  }),
}))

vi.mock('../utils/processPaymentResult', () => ({
  reconcilePayment: vi.fn().mockResolvedValue({ status: 'success' }),
}))

const freePlan: Plan = {
  reference: 'pln_free',
  name: 'Free',
  price: 0,
  currency: 'usd',
  type: 'recurring',
  interval: 'month',
  requiresPayment: false,
}

beforeEach(() => {
  plansCache.clear()
  productCache.clear()
  merchantCache.clear()
  plansCache.set('prd_free', {
    plans: [freePlan],
    timestamp: Date.now(),
    promise: null,
  })
  productCache.set('prd_free', {
    product: { reference: 'prd_free', name: 'Widget API' },
    promise: null,
    timestamp: Date.now(),
  })
  merchantCache.set('/api/merchant', {
    merchant: { legalName: 'Acme', displayName: 'Acme' },
    promise: null,
    timestamp: Date.now(),
  })
})

const fakeFetch = vi.fn(async () => new Response('{}', { status: 200 }))

describe('PaymentForm primitive', () => {
  it('Root emits stable data-solvapay-payment-form + data-state=ready + data-variant=free for free plans', async () => {
    const { container } = render(
      <SolvaPayProvider config={{ fetch: fakeFetch as unknown as typeof fetch }}>
        <PaymentForm.Root planRef="pln_free" productRef="prd_free">
          <PaymentForm.SubmitButton />
        </PaymentForm.Root>
      </SolvaPayProvider>,
    )
    await waitFor(() => {
      const root = container.querySelector('[data-solvapay-payment-form]')
      expect(root).toBeTruthy()
      expect(root?.getAttribute('data-state')).toBe('ready')
      expect(root?.getAttribute('data-variant')).toBe('free')
    })
  })

  it('SubmitButton emits data-state=idle + data-variant=free on a free plan', async () => {
    render(
      <SolvaPayProvider config={{ fetch: fakeFetch as unknown as typeof fetch }}>
        <PaymentForm.Root planRef="pln_free" productRef="prd_free">
          <PaymentForm.SubmitButton />
        </PaymentForm.Root>
      </SolvaPayProvider>,
    )
    const button = await screen.findByRole('button', { name: /Start using/ })
    expect(button.getAttribute('data-state')).toBe('idle')
    expect(button.getAttribute('data-variant')).toBe('free')
    expect(button.getAttribute('data-solvapay-payment-form-submit')).toBe('')
  })

  it('SubmitButton asChild forwards refs, merges handlers, preserves data-state', async () => {
    const ref = React.createRef<HTMLButtonElement>()
    const consumerClick = vi.fn()
    render(
      <SolvaPayProvider config={{ fetch: fakeFetch as unknown as typeof fetch }}>
        <PaymentForm.Root planRef="pln_free" productRef="prd_free">
          <PaymentForm.SubmitButton asChild>
            <button ref={ref} onClick={consumerClick} className="my-btn" data-testid="slotted">
              Activate now
            </button>
          </PaymentForm.SubmitButton>
        </PaymentForm.Root>
      </SolvaPayProvider>,
    )
    const slotted = await screen.findByTestId('slotted')
    expect(slotted.tagName).toBe('BUTTON')
    expect(slotted.className).toBe('my-btn')
    expect(slotted.getAttribute('data-state')).toBe('idle')
    expect(slotted.getAttribute('data-variant')).toBe('free')
    expect(ref.current).toBe(slotted)
    fireEvent.click(slotted)
    expect(consumerClick).toHaveBeenCalled()
  })

  it('Error subcomponent renders when the context exposes an error', async () => {
    const onError = vi.fn()
    const failingFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/api/activate-plan')) {
        return new Response('oh no', { status: 500 })
      }
      return new Response('{}', { status: 200 })
    })
    render(
      <SolvaPayProvider config={{ fetch: failingFetch as unknown as typeof fetch }}>
        <PaymentForm.Root planRef="pln_free" productRef="prd_free" onError={onError}>
          <PaymentForm.Error data-testid="err" />
          <PaymentForm.SubmitButton />
        </PaymentForm.Root>
      </SolvaPayProvider>,
    )
    const button = await screen.findByRole('button', { name: /Start using/ })
    fireEvent.click(button)
    await waitFor(() => expect(screen.getByTestId('err')).toBeTruthy())
    expect(screen.getByTestId('err').getAttribute('role')).toBe('alert')
  })

  it('throws MissingProviderError when Root is rendered outside SolvaPayProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      render(
        <PaymentForm.Root planRef="pln_free" productRef="prd_free">
          <PaymentForm.SubmitButton />
        </PaymentForm.Root>,
      ),
    ).toThrow(MissingProviderError)
    spy.mockRestore()
  })
})

// ---------- Paid-branch polling: MCP checkout flicker fix ----------

const paidPlan: Plan = {
  reference: 'pln_paid',
  name: 'Pro',
  price: 1999,
  currency: 'usd',
  type: 'recurring',
  interval: 'month',
}

type PaidHarnessHandle = {
  setHasPaidPurchase: (value: boolean) => void
  refetchCalls: () => number
}

const paidHarnessRef: { current: PaidHarnessHandle | null } = { current: null }

const PaidHarness: React.FC<{
  onRefetch?: (callCount: number, setPaid: (v: boolean) => void) => void
  onError?: (error: Error) => void
  children?: React.ReactNode
}> = ({ onRefetch, onError, children }) => {
  const [hasPaidPurchase, setHasPaidPurchase] = React.useState(false)
  const callCountRef = React.useRef(0)

  const refetchPurchase = React.useCallback(async () => {
    callCountRef.current += 1
    onRefetch?.(callCountRef.current, setHasPaidPurchase)
  }, [onRefetch])

  React.useEffect(() => {
    paidHarnessRef.current = {
      setHasPaidPurchase,
      refetchCalls: () => callCountRef.current,
    }
    return () => {
      paidHarnessRef.current = null
    }
  }, [])

  const ctx = React.useMemo<SolvaPayContextValue>(
    () => ({
      purchase: {
        loading: false,
        isRefetching: false,
        error: null,
        purchases: [],
        hasProduct: () => false,
        activePurchase: null,
        hasPaidPurchase,
        activePaidPurchase: null,
        balanceTransactions: [],
      },
      refetchPurchase,
      createPayment: vi.fn().mockResolvedValue({
        clientSecret: 'cs_test_123',
        publishableKey: 'pk_test',
      }),
      processPayment: vi.fn().mockResolvedValue({ status: 'succeeded' }),
      createTopupPayment: vi.fn(),
      cancelRenewal: vi.fn(),
      reactivateRenewal: vi.fn(),
      activatePlan: vi.fn(),
      balance: {
        loading: false,
        credits: null,
        displayCurrency: null,
        creditsPerMinorUnit: null,
        displayExchangeRate: null,
        refetch: vi.fn(),
        adjustBalance: vi.fn(),
      },
    }),
    [hasPaidPurchase, refetchPurchase],
  )

  return (
    <SolvaPayContext.Provider value={ctx}>
      <PaymentForm.Root planRef="pln_paid" productRef="prd_paid" onError={onError}>
        <PaymentForm.PaymentElement />
        {children}
        <PaymentForm.SubmitButton data-testid="submit" />
        <PaymentForm.Error data-testid="err" />
      </PaymentForm.Root>
    </SolvaPayContext.Provider>
  )
}

describe('PaymentForm paid-branch polling (MCP checkout flicker fix)', () => {
  beforeEach(() => {
    plansCache.clear()
    productCache.clear()
    merchantCache.clear()
    plansCache.set('prd_paid', {
      plans: [paidPlan],
      timestamp: Date.now(),
      promise: null,
    })
    productCache.set('prd_paid', {
      product: { reference: 'prd_paid', name: 'Widget API' },
      promise: null,
      timestamp: Date.now(),
    })
    merchantCache.set('/api/merchant', {
      merchant: { legalName: 'Acme', displayName: 'Acme' },
      promise: null,
      timestamp: Date.now(),
    })
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function clickSubmitAndAwaitProcessing() {
    const button = await screen.findByTestId('submit')
    // Wait for canSubmit to be true (Elements + clientSecret + paymentInputComplete)
    await waitFor(() => {
      expect(button.getAttribute('data-state')).toBe('idle')
    })
    await act(async () => {
      fireEvent.click(button)
    })
    // After click, confirmPayment + reconcilePayment resolve on microtasks;
    // flush them so the polling loop is definitely running.
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    return button
  }

  it('keeps isProcessing=true while hasPaidPurchase is still false after the first refetch, then flips off once the provider observes the paid purchase', async () => {
    render(<PaidHarness onRefetch={(_calls, _set) => {}} />)

    const button = await clickSubmitAndAwaitProcessing()

    // First refetch attempt — stale read, hasPaidPurchase still false.
    // The loop waits 500ms before issuing the refetch.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(paidHarnessRef.current?.refetchCalls()).toBeGreaterThanOrEqual(1)
    expect(button.getAttribute('data-state')).toBe('processing')
    expect(button.getAttribute('aria-busy')).toBe('true')

    // Still stale after another poll — button must remain busy.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100)
    })
    expect(button.getAttribute('data-state')).toBe('processing')

    // Provider finally observes the paid purchase (simulates the backend
    // returning the newly-created purchase on the next check_purchase call).
    act(() => {
      paidHarnessRef.current?.setHasPaidPurchase(true)
    })

    // Drain the current poll's wait so the loop sees the updated ref
    // (populated via the mirroring useEffect) and exits.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600)
    })

    await waitFor(() => {
      expect(button.getAttribute('data-state')).toBe('idle')
    })
    expect(screen.queryByTestId('err')?.textContent ?? '').toBe('')
  })

  it('surfaces paymentConfirmationDelayed error and re-enables the button after the 10s ceiling when hasPaidPurchase never flips', async () => {
    const onError = vi.fn()
    render(<PaidHarness onError={onError} />)

    const button = await clickSubmitAndAwaitProcessing()

    // Burn through the full 10s polling ceiling. Use multiple shorter
    // advances so React has a chance to commit between iterations.
    for (let i = 0; i < 12; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
    }

    await waitFor(() => {
      expect(screen.getByTestId('err').textContent).toBe(
        enCopy.errors.paymentConfirmationDelayed,
      )
    })
    expect(button.getAttribute('data-state')).toBe('idle')
    expect(onError).toHaveBeenCalledWith(expect.any(Error))
    expect(onError.mock.calls[0][0].message).toBe(
      enCopy.errors.paymentConfirmationDelayed,
    )
    // At least a handful of refetches were attempted before the ceiling hit.
    expect(paidHarnessRef.current?.refetchCalls() ?? 0).toBeGreaterThanOrEqual(3)
  })
})
