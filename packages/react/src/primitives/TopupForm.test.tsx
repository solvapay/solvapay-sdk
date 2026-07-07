/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React, { createRef } from 'react'
import { TopupForm, useTopupForm } from './TopupForm'
import { SolvaPayContext } from '../SolvaPayProvider'
import { MissingProviderError } from '../utils/errors'
import type { SolvaPayContextValue } from '../types'

// Captures the last `options` prop received by the mocked Stripe
// `PaymentElement` so integration tests can assert `TopupForm.PaymentElement`
// forwards SolvaPay defaults (e.g. `wallets.link = 'never'`).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lastPaymentElementOptions: { current: any } = { current: undefined }

const stripeMocks = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  submit: vi.fn<(...args: any[]) => Promise<{ error?: { message: string } }>>(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  confirmPayment: vi.fn<(...args: any[]) => Promise<unknown>>(),
}))

vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'stripe-elements' }, children),
  useStripe: () => ({ confirmPayment: stripeMocks.confirmPayment }),
  useElements: () => ({ getElement: vi.fn(), submit: stripeMocks.submit }),
  PaymentElement: (props: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options?: any
    onChange?: (event: { complete: boolean }) => void
  }) => {
    lastPaymentElementOptions.current = props.options
    // Render as a button so tests can fire the `onChange({ complete: true })`
    // signal that flips the SubmitButton from `disabled` to `idle`.
    return React.createElement('button', {
      'data-testid': 'payment-element',
      type: 'button',
      onClick: () => props.onChange?.({ complete: true }),
    })
  },
}))

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(() => Promise.resolve({ confirmPayment: vi.fn() })),
}))

function ctx(overrides?: Partial<SolvaPayContextValue>): SolvaPayContextValue {
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
    },
    refetchPurchase: vi.fn().mockResolvedValue(undefined),
    upsertPurchase: vi.fn(),
    createPayment: vi.fn(),
    createTopupPayment: vi.fn().mockResolvedValue({
      clientSecret: 'pi_topup_secret',
      publishableKey: 'pk_test_123',
    }),
    // Default `processTopupPayment` impl resolves to `succeeded` so the
    // happy-path tests below get the production gating behaviour
    // without manually wiring it on every render. Tests covering the
    // failed / cancelled / timeout / absent branches override.
    processTopupPayment: vi.fn().mockResolvedValue({ status: 'succeeded' }),
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
    ...overrides,
  }
}

function Wrap({ value, children }: { value: SolvaPayContextValue; children: React.ReactNode }) {
  return React.createElement(SolvaPayContext.Provider, { value }, children)
}

beforeEach(() => {
  vi.clearAllMocks()
  lastPaymentElementOptions.current = undefined
  stripeMocks.submit.mockResolvedValue({})
  stripeMocks.confirmPayment.mockResolvedValue({
    paymentIntent: { id: 'pi_test_123', status: 'succeeded' },
  })
})

describe('TopupForm primitive', () => {
  it('renders children (SubmitButton disabled) during the pre-Elements load', () => {
    render(
      <Wrap value={ctx()}>
        <TopupForm.Root amount={1000} data-testid="root">
          <TopupForm.PaymentElement />
          <TopupForm.SubmitButton data-testid="submit" />
          <TopupForm.Loading data-testid="loading" />
        </TopupForm.Root>
      </Wrap>,
    )
    const btn = screen.getByTestId('submit')
    expect(btn).toBeDisabled()
    expect(btn.getAttribute('data-state')).toBe('disabled')
    expect(screen.getByTestId('loading')).toBeTruthy()
  })

  it('data-state=error when amount is not positive and Error renders', () => {
    render(
      <Wrap value={ctx()}>
        <TopupForm.Root amount={0} data-testid="root">
          <TopupForm.Error data-testid="error" />
          <TopupForm.SubmitButton />
        </TopupForm.Root>
      </Wrap>,
    )
    const root = screen.getByTestId('root')
    expect(root.getAttribute('data-state')).toBe('error')
    expect(screen.getByTestId('error').textContent).toMatch(/amount must be a positive number/i)
  })

  it('useTopupForm hook exposes state + amount for custom leaves', () => {
    const Probe = () => {
      const { amount, state } = useTopupForm()
      return (
        <span data-testid="probe">
          {state}:{amount}
        </span>
      )
    }
    render(
      <Wrap value={ctx()}>
        <TopupForm.Root amount={1000}>
          <Probe />
        </TopupForm.Root>
      </Wrap>,
    )
    expect(screen.getByTestId('probe').textContent).toBe('loading:1000')
  })

  it('asChild swaps Root shell and merges refs', () => {
    const ref = createRef<HTMLDivElement>()
    render(
      <Wrap value={ctx()}>
        <TopupForm.Root asChild amount={1000} data-testid="root">
          <section ref={ref as unknown as React.Ref<HTMLDivElement>} className="from-consumer">
            <TopupForm.SubmitButton />
          </section>
        </TopupForm.Root>
      </Wrap>,
    )
    const root = screen.getByTestId('root')
    expect(root.tagName).toBe('SECTION')
    expect(root.className).toContain('from-consumer')
    expect(ref.current).toBe(root)
  })

  // Regression: clicking the Pay button used to nuke the consumer's
  // wrapper element styling. The old asChild branch passed a Fragment
  // (Spinner + "Processing") as the Slot's child during the processing
  // transition, so className/disabled/onClick landed on the Fragment
  // instead of the consumer's <button>, and the rendered DOM lost all
  // styling and the click handler. The fix preserves the wrapper and
  // swaps only its inner content.
  it('asChild preserves the consumer wrapper element when isProcessing flips', async () => {
    const resolveConfirm: { current: ((value: unknown) => void) | null } = {
      current: null,
    }
    stripeMocks.confirmPayment.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveConfirm.current = resolve
        }),
    )

    render(
      <Wrap value={ctx()}>
        <TopupForm.Root amount={1000}>
          <TopupForm.PaymentElement />
          <TopupForm.SubmitButton asChild>
            <button data-testid="pay" className="pay-btn">
              Pay $10
            </button>
          </TopupForm.SubmitButton>
        </TopupForm.Root>
      </Wrap>,
    )

    // `TopupForm.Root` swaps OfflineInner → <Elements>+Inner after
    // `createTopupPayment` resolves, which unmounts the initial button.
    // Wait for the post-switch render before grabbing a reference.
    await waitFor(() =>
      expect(document.querySelector('[data-solvapay-topup-form-payment-element]')).toBeTruthy(),
    )

    const pe = screen.getByTestId('payment-element')
    await act(async () => {
      fireEvent.click(pe)
    })

    await waitFor(() => expect(screen.getByTestId('pay').getAttribute('data-state')).toBe('idle'))

    const button = screen.getByTestId('pay')
    expect(button.tagName).toBe('BUTTON')
    expect(button.className).toBe('pay-btn')
    expect(button.textContent).toBe('Pay $10')

    await act(async () => {
      fireEvent.click(button)
    })

    await waitFor(() =>
      expect(screen.getByTestId('pay').getAttribute('data-state')).toBe('processing'),
    )

    // The wrapper survives: same DOM node, same tag, consumer className
    // intact, and the inner content was swapped to the spinner + label.
    const processingButton = screen.getByTestId('pay')
    expect(processingButton).toBe(button)
    expect(processingButton.tagName).toBe('BUTTON')
    expect(processingButton.className).toBe('pay-btn')
    expect(processingButton.getAttribute('aria-busy')).toBe('true')
    expect((processingButton as HTMLButtonElement).disabled).toBe(true)
    expect(processingButton.textContent).toMatch(/processing/i)

    resolveConfirm.current?.({ paymentIntent: { id: 'pi_test_123', status: 'succeeded' } })
    await waitFor(() => expect(stripeMocks.confirmPayment).toHaveBeenCalled())
  })

  it('throws MissingProviderError when rendered outside SolvaPayProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      render(
        <TopupForm.Root amount={1000}>
          <TopupForm.SubmitButton />
        </TopupForm.Root>,
      ),
    ).toThrow(MissingProviderError)
    spy.mockRestore()
  })
})

// ---------- PaymentElement default options (Stripe Link disabled) ----------
//
// Guards the centralized `withPaymentElementDefaults` wire-up inside
// `TopupForm.PaymentElement`. The Link sign-in banner + "Save my
// information for faster checkout" enrollment UI would duplicate the
// SolvaPay-owned "Save card for future top-ups" affordance, so the
// primitive must pass `wallets.link = 'never'` to Stripe by default
// while still letting callers override via `options`.

// ---------- Backend gate on onSuccess ----------
//
// Regression guard for the topup badge-stale / slow LLM reply bug:
// `TopupForm.onSuccess` previously fired the instant Stripe's
// `confirmPayment` resolved, racing the SolvaPay webhook that books
// the credit. The fix gates `onSuccess` on `processTopupPayment`
// completing, so by the time the drawer closes the customer is
// fully credited.

describe('TopupForm submit gates onSuccess on processTopupPayment', () => {
  it('awaits processTopupPayment before firing onSuccess', async () => {
    const onSuccess = vi.fn()
    const processTopupPayment = vi.fn().mockResolvedValue({ status: 'succeeded' })

    render(
      <Wrap value={ctx({ processTopupPayment })}>
        <TopupForm.Root amount={1000} onSuccess={onSuccess}>
          <TopupForm.PaymentElement />
          <TopupForm.SubmitButton data-testid="submit" />
        </TopupForm.Root>
      </Wrap>,
    )

    await waitFor(() =>
      expect(document.querySelector('[data-solvapay-topup-form-payment-element]')).toBeTruthy(),
    )

    // Flip paymentInputComplete=true so the submit button enables.
    await act(async () => {
      fireEvent.click(screen.getByTestId('payment-element'))
    })
    await waitFor(() =>
      expect(screen.getByTestId('submit').getAttribute('data-state')).toBe('idle'),
    )

    await act(async () => {
      fireEvent.click(screen.getByTestId('submit'))
    })

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))

    expect(processTopupPayment).toHaveBeenCalledTimes(1)
    expect(processTopupPayment).toHaveBeenCalledWith({ paymentIntentId: 'pi_test_123' })
    // onSuccess fires AFTER processTopupPayment resolves — verify call order.
    expect(processTopupPayment.mock.invocationCallOrder[0]).toBeLessThan(
      onSuccess.mock.invocationCallOrder[0],
    )
  })

  it('routes status: failed to onError and surfaces an error message', async () => {
    const onSuccess = vi.fn()
    const onError = vi.fn()
    const processTopupPayment = vi.fn().mockResolvedValue({ status: 'failed' })

    render(
      <Wrap value={ctx({ processTopupPayment })}>
        <TopupForm.Root amount={1000} onSuccess={onSuccess} onError={onError}>
          <TopupForm.PaymentElement />
          <TopupForm.SubmitButton data-testid="submit" />
          <TopupForm.Error data-testid="error" />
        </TopupForm.Root>
      </Wrap>,
    )

    await waitFor(() =>
      expect(document.querySelector('[data-solvapay-topup-form-payment-element]')).toBeTruthy(),
    )
    await act(async () => {
      fireEvent.click(screen.getByTestId('payment-element'))
    })
    await waitFor(() =>
      expect(screen.getByTestId('submit').getAttribute('data-state')).toBe('idle'),
    )

    await act(async () => {
      fireEvent.click(screen.getByTestId('submit'))
    })

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(onSuccess).not.toHaveBeenCalled()
    expect((onError.mock.calls[0][0] as Error).message).toBe('Topup failed')
    expect(screen.getByTestId('error')).toBeTruthy()
    // isProcessing resets so the button is interactive again.
    expect(screen.getByTestId('submit').getAttribute('data-state')).not.toBe('processing')
  })

  it('routes status: cancelled to onError', async () => {
    const onSuccess = vi.fn()
    const onError = vi.fn()
    const processTopupPayment = vi.fn().mockResolvedValue({ status: 'cancelled' })

    render(
      <Wrap value={ctx({ processTopupPayment })}>
        <TopupForm.Root amount={1000} onSuccess={onSuccess} onError={onError}>
          <TopupForm.PaymentElement />
          <TopupForm.SubmitButton data-testid="submit" />
        </TopupForm.Root>
      </Wrap>,
    )

    await waitFor(() =>
      expect(document.querySelector('[data-solvapay-topup-form-payment-element]')).toBeTruthy(),
    )
    await act(async () => {
      fireEvent.click(screen.getByTestId('payment-element'))
    })
    await waitFor(() =>
      expect(screen.getByTestId('submit').getAttribute('data-state')).toBe('idle'),
    )

    await act(async () => {
      fireEvent.click(screen.getByTestId('submit'))
    })

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(onSuccess).not.toHaveBeenCalled()
    expect((onError.mock.calls[0][0] as Error).message).toBe('Topup cancelled')
  })

  it('treats status: timeout as a soft success — fires onSuccess', async () => {
    // The backend confirms the PI hasn't been observed succeeded within
    // its 10s poll window. Stripe already confirmed though, so the
    // credit will land via webhook shortly — fall through and let the
    // downstream `refetchPurchase` converge.
    const onSuccess = vi.fn()
    const onError = vi.fn()
    const processTopupPayment = vi.fn().mockResolvedValue({
      status: 'timeout',
      message: 'Webhook delayed',
    })

    render(
      <Wrap value={ctx({ processTopupPayment })}>
        <TopupForm.Root amount={1000} onSuccess={onSuccess} onError={onError}>
          <TopupForm.PaymentElement />
          <TopupForm.SubmitButton data-testid="submit" />
        </TopupForm.Root>
      </Wrap>,
    )

    await waitFor(() =>
      expect(document.querySelector('[data-solvapay-topup-form-payment-element]')).toBeTruthy(),
    )
    await act(async () => {
      fireEvent.click(screen.getByTestId('payment-element'))
    })
    await waitFor(() =>
      expect(screen.getByTestId('submit').getAttribute('data-state')).toBe('idle'),
    )

    await act(async () => {
      fireEvent.click(screen.getByTestId('submit'))
    })

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(onError).not.toHaveBeenCalled()
  })

  it('routes thrown errors from processTopupPayment to onError', async () => {
    const onSuccess = vi.fn()
    const onError = vi.fn()
    const processTopupPayment = vi.fn().mockRejectedValue(new Error('Network blew up'))

    render(
      <Wrap value={ctx({ processTopupPayment })}>
        <TopupForm.Root amount={1000} onSuccess={onSuccess} onError={onError}>
          <TopupForm.PaymentElement />
          <TopupForm.SubmitButton data-testid="submit" />
        </TopupForm.Root>
      </Wrap>,
    )

    await waitFor(() =>
      expect(document.querySelector('[data-solvapay-topup-form-payment-element]')).toBeTruthy(),
    )
    await act(async () => {
      fireEvent.click(screen.getByTestId('payment-element'))
    })
    await waitFor(() =>
      expect(screen.getByTestId('submit').getAttribute('data-state')).toBe('idle'),
    )

    await act(async () => {
      fireEvent.click(screen.getByTestId('submit'))
    })

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(onSuccess).not.toHaveBeenCalled()
    expect((onError.mock.calls[0][0] as Error).message).toBe('Network blew up')
  })

  it('forwards backend creditsAdded to onSuccess via the extras argument', async () => {
    const onSuccess = vi.fn()
    const processTopupPayment = vi.fn().mockResolvedValue({
      status: 'succeeded',
      creditsAdded: 250,
    })

    render(
      <Wrap value={ctx({ processTopupPayment })}>
        <TopupForm.Root amount={1000} onSuccess={onSuccess}>
          <TopupForm.PaymentElement />
          <TopupForm.SubmitButton data-testid="submit" />
        </TopupForm.Root>
      </Wrap>,
    )

    await waitFor(() =>
      expect(document.querySelector('[data-solvapay-topup-form-payment-element]')).toBeTruthy(),
    )
    await act(async () => {
      fireEvent.click(screen.getByTestId('payment-element'))
    })
    await waitFor(() =>
      expect(screen.getByTestId('submit').getAttribute('data-state')).toBe('idle'),
    )

    await act(async () => {
      fireEvent.click(screen.getByTestId('submit'))
    })

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'pi_test_123' }),
      { creditsAdded: 250 },
    )
  })

  it('omits the extras argument when the backend does not surface creditsAdded', async () => {
    // Soft-success path: backend confirmed PI but post-success poll
    // exhausted before the wallet observed the delta. `onSuccess`
    // fires without the optimistic hint; downstream `refetchPurchase`
    // still converges the UI.
    const onSuccess = vi.fn()
    const processTopupPayment = vi.fn().mockResolvedValue({ status: 'succeeded' })

    render(
      <Wrap value={ctx({ processTopupPayment })}>
        <TopupForm.Root amount={1000} onSuccess={onSuccess}>
          <TopupForm.PaymentElement />
          <TopupForm.SubmitButton data-testid="submit" />
        </TopupForm.Root>
      </Wrap>,
    )

    await waitFor(() =>
      expect(document.querySelector('[data-solvapay-topup-form-payment-element]')).toBeTruthy(),
    )
    await act(async () => {
      fireEvent.click(screen.getByTestId('payment-element'))
    })
    await waitFor(() =>
      expect(screen.getByTestId('submit').getAttribute('data-state')).toBe('idle'),
    )

    await act(async () => {
      fireEvent.click(screen.getByTestId('submit'))
    })

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'pi_test_123' }),
      undefined,
    )
  })

  it('falls through to legacy fire-on-confirm when processTopupPayment is absent', async () => {
    // Legacy / partial transports without `processTopupPayment` keep
    // the pre-fix behaviour: onSuccess fires immediately on Stripe
    // confirm. Not the recommended path (the customer can be
    // momentarily uncredited) but preserved for backwards compat.
    const onSuccess = vi.fn()

    render(
      <Wrap value={ctx({ processTopupPayment: undefined })}>
        <TopupForm.Root amount={1000} onSuccess={onSuccess}>
          <TopupForm.PaymentElement />
          <TopupForm.SubmitButton data-testid="submit" />
        </TopupForm.Root>
      </Wrap>,
    )

    await waitFor(() =>
      expect(document.querySelector('[data-solvapay-topup-form-payment-element]')).toBeTruthy(),
    )
    await act(async () => {
      fireEvent.click(screen.getByTestId('payment-element'))
    })
    await waitFor(() =>
      expect(screen.getByTestId('submit').getAttribute('data-state')).toBe('idle'),
    )

    await act(async () => {
      fireEvent.click(screen.getByTestId('submit'))
    })

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
  })
})

describe('TopupForm.PaymentElement default options', () => {
  it('disables Stripe Link by default when the caller passes no options', async () => {
    render(
      <Wrap value={ctx()}>
        <TopupForm.Root amount={1000}>
          <TopupForm.PaymentElement />
        </TopupForm.Root>
      </Wrap>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('payment-element')).toBeTruthy()
    })
    expect(lastPaymentElementOptions.current?.wallets?.link).toBe('never')
  })

  it('honours caller-supplied wallets.link override', async () => {
    render(
      <Wrap value={ctx()}>
        <TopupForm.Root amount={1000}>
          <TopupForm.PaymentElement options={{ wallets: { link: 'auto' } }} />
        </TopupForm.Root>
      </Wrap>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('payment-element')).toBeTruthy()
    })
    expect(lastPaymentElementOptions.current?.wallets?.link).toBe('auto')
  })

  it('composes caller-supplied wallet flags with the default link=never', async () => {
    render(
      <Wrap value={ctx()}>
        <TopupForm.Root amount={1000}>
          <TopupForm.PaymentElement options={{ wallets: { applePay: 'never' } }} />
        </TopupForm.Root>
      </Wrap>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('payment-element')).toBeTruthy()
    })
    expect(lastPaymentElementOptions.current?.wallets).toEqual({
      link: 'never',
      applePay: 'never',
    })
  })
})
