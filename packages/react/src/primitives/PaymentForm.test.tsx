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
import { configureCollect } from '../vault/collect'
import { createFakeCollect, type FakeCollectHandle } from '../../../test-utils/src/fake-collect'
import type { Plan, PurchaseInfo, SolvaPayContextValue } from '../types'
import { mockBalanceStatus } from '../test-helpers/mockBalanceStatus'

// ---------- Paid-plan success-branch mocks ----------
//
// The paid-branch tests below drive <PaymentForm.Root> through the vault
// card fields (fake VGS Collect) and mock `reconcilePayment` so the
// component hits the synchronous `upsertPurchase` merge that replaces the
// post-reconcile polling loop (plan: fix-lifetime-badge-stale).
//
// FreeInner never touches the vault or reconcilePayment.

vi.mock('../utils/processPaymentResult', () => ({
  reconcilePayment: vi.fn().mockResolvedValue({ status: 'success' }),
}))

const attachHookMock = vi.hoisted(() => ({
  runAttach: vi.fn().mockResolvedValue(true),
  setBusinessDetails: vi.fn(),
}))

vi.mock('../hooks/useBusinessDetailsAttach', () => ({
  defaultBusinessDetails: { isBusiness: false },
  useBusinessDetailsAttach: vi.fn(() => ({
    businessDetails: { isBusiness: false, customerCountry: 'SE' },
    setBusinessDetails: attachHookMock.setBusinessDetails,
    fieldErrors: {},
    taxBreakdown: null,
    businessDetailsAttached: true,
    businessDetailsAttaching: false,
    businessDetailsError: null,
    requiresBusinessAttach: false,
    runAttach: attachHookMock.runAttach,
  })),
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

// ---------- Paid-branch post-success: synchronous `upsertPurchase` merge ----------

const paidPlan: Plan = {
  reference: 'pln_paid',
  name: 'Pro',
  price: 1999,
  currency: 'usd',
  type: 'recurring',
  interval: 'month',
}

const seededRecurringPurchase: PurchaseInfo = {
  reference: 'pur_seed_recurring',
  customerRef: 'cus_seed',
  productName: 'Widget API',
  productRef: 'prd_recurring',
  status: 'active',
  startDate: '2026-01-01T00:00:00Z',
  createdAt: '2026-01-01T00:00:00Z',
  amount: 1999,
  currency: 'usd',
  isRecurring: true,
  planSnapshot: { currency: 'usd', price: 1999, isMetered: false },
}

type PaidHarnessHandle = {
  upsertPurchase: ReturnType<typeof vi.fn>
  refetchPurchase: ReturnType<typeof vi.fn>
  currentPurchases: () => PurchaseInfo[]
}

const paidHarnessRef: { current: PaidHarnessHandle | null } = { current: null }

const PaidHarness: React.FC<{
  onError?: (error: Error) => void
  onSuccess?: (paymentIntent: unknown) => void
  initialPurchases?: PurchaseInfo[]
  children?: React.ReactNode
}> = ({ onError, onSuccess, initialPurchases = [], children }) => {
  const [purchases, setPurchases] = React.useState<PurchaseInfo[]>(initialPurchases)

  const upsertPurchase = React.useMemo(
    () =>
      vi.fn((incoming: PurchaseInfo) => {
        setPurchases(prev => {
          const next = prev.filter(p => p.reference !== incoming.reference)
          next.push(incoming)
          return next
        })
      }),
    [],
  )

  const refetchPurchase = React.useMemo(() => vi.fn(async () => {}), [])

  React.useEffect(() => {
    paidHarnessRef.current = {
      upsertPurchase,
      refetchPurchase,
      currentPurchases: () => purchases,
    }
    return () => {
      paidHarnessRef.current = null
    }
  }, [upsertPurchase, refetchPurchase, purchases])

  const ctx = React.useMemo<SolvaPayContextValue>(
    () => ({
      purchase: {
        loading: false,
        isRefetching: false,
        error: null,
        purchases,
        hasProduct: () => false,
        activePurchase: purchases[0] ?? null,
        hasPaidPurchase: purchases.some(p => (p.amount ?? 0) > 0 && p.status === 'active'),
        activePaidPurchase: purchases.find(p => (p.amount ?? 0) > 0) ?? null,
        balanceTransactions: [],
      },
      refetchPurchase,
      upsertPurchase,
      createPayment: vi.fn().mockResolvedValue({
        id: 'pi_sp_paid',
        captureMode: 'vault',
        vault: { tenantId: 'tntr4ol0cbq', environment: 'sandbox' },
        customerRef: 'cus_seed',
      }),
      processPayment: vi.fn(),
      createTopupPayment: vi.fn(),
      createCaptureGrant: vi.fn().mockResolvedValue({
        token: 'vgs-collect-token',
        tenantId: 'tntr4ol0cbq',
        environment: 'sandbox',
        expiresAt: Date.now() + 60_000,
        scope: { paymentIntentId: 'pi_sp_paid' },
      }),
      confirmPayment: vi.fn().mockResolvedValue({
        id: 'pi_sp_paid',
        processorPaymentId: 'pi_rail_paid',
        status: 'succeeded',
      }),
      cancelRenewal: vi.fn(),
      reactivateRenewal: vi.fn(),
      activatePlan: vi.fn(),
      balance: mockBalanceStatus(),
    }),
    [purchases, refetchPurchase, upsertPurchase],
  )

  return (
    <SolvaPayContext.Provider value={ctx}>
      <PaymentForm.Root
        planRef="pln_paid"
        productRef="prd_paid"
        onError={onError}
        onSuccess={onSuccess}
      >
        <PaymentForm.CardFields data-testid="card-fields" />
        {children}
        <PaymentForm.SubmitButton data-testid="submit" />
        <PaymentForm.Error data-testid="err" />
      </PaymentForm.Root>
    </SolvaPayContext.Provider>
  )
}

describe('PaymentForm post-success purchase merge', () => {
  let collect: FakeCollectHandle
  let restoreCollect: () => void

  afterEach(() => {
    restoreCollect()
  })

  beforeEach(() => {
    collect = createFakeCollect()
    restoreCollect = configureCollect(collect.loader)
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
  })

  async function clickSubmitAndSettle() {
    await waitFor(() =>
      expect(screen.getByTestId('card-fields')).toHaveAttribute('data-state', 'ready'),
    )
    act(() => collect.enter())
    const button = await waitFor(() => {
      const next = screen.getByTestId('submit')
      expect(next.getAttribute('data-state')).toBe('idle')
      return next
    })
    await act(async () => {
      fireEvent.click(button)
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    return button
  }

  it('upserts a recurring purchase from a fresh `processPaymentIntent` result and clears isProcessing without a refetch', async () => {
    const reconcilePaymentMock = (await import('../utils/processPaymentResult'))
      .reconcilePayment as ReturnType<typeof vi.fn>
    const freshPurchase = {
      reference: 'pur_fresh_recurring',
      customerRef: 'cus_seed',
      productName: 'Widget API',
      productRef: 'prd_paid',
      status: 'active',
      startDate: '2026-05-12T00:00:00Z',
      createdAt: '2026-05-12T00:00:00Z',
      amount: 1999,
      currency: 'usd',
      isRecurring: true,
      planSnapshot: { currency: 'usd', price: 1999, isMetered: false },
    } satisfies PurchaseInfo
    reconcilePaymentMock.mockResolvedValueOnce({
      status: 'success',
      result: {
        status: 'succeeded',
        type: 'recurring',
        purchase: freshPurchase,
      },
    })

    const onSuccess = vi.fn()
    render(<PaidHarness onSuccess={onSuccess} />)
    const button = await clickSubmitAndSettle()

    await waitFor(() => {
      expect(paidHarnessRef.current?.upsertPurchase).toHaveBeenCalledTimes(1)
    })
    expect(paidHarnessRef.current?.upsertPurchase).toHaveBeenCalledWith(freshPurchase)
    expect(paidHarnessRef.current?.refetchPurchase).not.toHaveBeenCalled()
    expect(onSuccess).toHaveBeenCalledTimes(1)

    await waitFor(() => {
      expect(button.getAttribute('data-state')).toBe('idle')
    })
    expect(paidHarnessRef.current?.currentPurchases().length).toBe(1)
    expect(screen.queryByTestId('err')?.textContent ?? '').toBe('')
  })

  it('falls back to refetch when reconcile returns a bare `succeeded` shape (webhook race) and clears isProcessing', async () => {
    const reconcilePaymentMock = (await import('../utils/processPaymentResult'))
      .reconcilePayment as ReturnType<typeof vi.fn>
    reconcilePaymentMock.mockResolvedValueOnce({
      status: 'success',
      result: { status: 'succeeded' },
    })

    const onSuccess = vi.fn()
    render(<PaidHarness onSuccess={onSuccess} />)
    const button = await clickSubmitAndSettle()

    await waitFor(() => {
      expect(paidHarnessRef.current?.refetchPurchase).toHaveBeenCalledTimes(1)
    })
    expect(paidHarnessRef.current?.upsertPurchase).not.toHaveBeenCalled()
    expect(onSuccess).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(button.getAttribute('data-state')).toBe('idle')
    })
  })

  it('releases the SubmitButton even when upsertPurchase throws synchronously (try/finally safety net)', async () => {
    // The thrown error propagates out of submit() as an unhandled rejection
    // (SubmitButton fires submit() and forgets). We suppress it here because
    // the test is explicitly about the finally releasing the button — not
    // about consumer callback throws becoming a silent failure.
    const swallowExpectedThrow = (err: unknown): void => {
      if (err instanceof Error && err.message === 'upsert exploded') return
      throw err
    }
    process.on('unhandledRejection', swallowExpectedThrow)

    try {
      const reconcilePaymentMock = (await import('../utils/processPaymentResult'))
        .reconcilePayment as ReturnType<typeof vi.fn>
      reconcilePaymentMock.mockResolvedValueOnce({
        status: 'success',
        result: {
          status: 'succeeded',
          type: 'recurring',
          purchase: {
            reference: 'pur_throw',
            customerRef: 'cus_seed',
            productName: 'Widget API',
            productRef: 'prd_paid',
            status: 'active',
            startDate: '2026-05-12T00:00:00Z',
            createdAt: '2026-05-12T00:00:00Z',
            amount: 1999,
            currency: 'usd',
            isRecurring: true,
          } satisfies PurchaseInfo,
        },
      })

      // Render the harness, then swap `upsertPurchase` for one that throws.
      // We can't pass it in directly without leaking implementation detail
      // through PaidHarness, so we mutate the ref the harness publishes.
      render(<PaidHarness />)
      await waitFor(() => expect(paidHarnessRef.current).toBeTruthy())
      paidHarnessRef.current!.upsertPurchase.mockImplementationOnce(() => {
        throw new Error('upsert exploded')
      })

      const button = await clickSubmitAndSettle()

      // The thrown error propagates out of submit() but the finally must
      // still flip the button back to `idle` so the user can retry.
      await waitFor(() => {
        expect(button.getAttribute('data-state')).toBe('idle')
      })
    } finally {
      process.off('unhandledRejection', swallowExpectedThrow)
    }
  })

  it('normalises a one-time purchase from `processPaymentIntent` and merges it alongside an existing recurring row', async () => {
    const reconcilePaymentMock = (await import('../utils/processPaymentResult'))
      .reconcilePayment as ReturnType<typeof vi.fn>
    reconcilePaymentMock.mockResolvedValueOnce({
      status: 'success',
      result: {
        status: 'succeeded',
        type: 'one-time',
        oneTimePurchase: {
          reference: 'pur_fresh_lifetime',
          customerRef: 'cus_seed',
          productRef: 'prd_paid',
          amount: 9900,
          currency: 'usd',
          completedAt: '2026-05-12T12:00:00Z',
          createdAt: '2026-05-12T12:00:00Z',
        },
      },
    })

    const onSuccess = vi.fn()
    render(
      <PaidHarness onSuccess={onSuccess} initialPurchases={[seededRecurringPurchase]} />,
    )
    const button = await clickSubmitAndSettle()

    await waitFor(() => {
      expect(paidHarnessRef.current?.upsertPurchase).toHaveBeenCalledTimes(1)
    })
    const merged = paidHarnessRef.current?.upsertPurchase.mock.calls[0]?.[0] as PurchaseInfo
    expect(merged).toMatchObject({
      reference: 'pur_fresh_lifetime',
      status: 'active',
      amount: 9900,
      currency: 'usd',
      isRecurring: false,
      origin: 'one_time',
      planSnapshot: { currency: 'usd', price: 9900, isMetered: false },
    })
    expect(paidHarnessRef.current?.refetchPurchase).not.toHaveBeenCalled()
    expect(onSuccess).toHaveBeenCalledTimes(1)

    await waitFor(() => {
      expect(button.getAttribute('data-state')).toBe('idle')
    })
    // Started with 1 recurring row; one-time merge should bump it to 2.
    expect(paidHarnessRef.current?.currentPurchases().length).toBe(2)
  })
})
