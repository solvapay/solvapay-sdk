/**
 * PaymentForm primitive tests.
 *
 * Focuses on the primitive contract (asChild / data-state / data-variant /
 * Loading + Error / structured errors). Free-plan behavioral coverage
 * (activation path, onFreePlan override, terms gating) lives in
 * `PaymentForm.freePlan.test.tsx`.
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import React from 'react'
import { PaymentForm } from './PaymentForm'
import { SolvaPayProvider } from '../SolvaPayProvider'
import { plansCache } from '../hooks/usePlans'
import { productCache } from '../hooks/useProduct'
import { merchantCache } from '../hooks/useMerchant'
import { MissingProviderError } from '../utils/errors'
import type { Plan } from '../types'

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
