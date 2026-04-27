/**
 * Free-plan routing inside <PaymentForm>: when plan.requiresPayment === false
 * the form bypasses Stripe Elements and either calls onFreePlan or activates
 * via useActivation. onResult fires with { kind: 'activated', ... }.
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import React from 'react'
import { PaymentForm } from './PaymentForm'
import { SolvaPayProvider } from './SolvaPayProvider'
import { plansCache } from './hooks/usePlans'
import { productCache } from './hooks/useProduct'
import { merchantCache } from './hooks/useMerchant'
import type { CheckoutResult, Plan } from './types'

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
    merchant: { legalName: 'Acme Inc', displayName: 'Acme' },
    promise: null,
    timestamp: Date.now(),
  })
})

function renderWith(
  extraProps: Partial<React.ComponentProps<typeof PaymentForm>> = {},
) {
  const activateCalls: Array<{ productRef: string; planRef: string }> = []
  const fakeFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (url.includes('/api/activate-plan')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        productRef: string
        planRef: string
      }
      activateCalls.push(body)
      return new Response(
        JSON.stringify({
          status: 'activated',
          productRef: body.productRef,
          planRef: body.planRef,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    if (url.includes('/api/check-purchase')) {
      return new Response(JSON.stringify({ purchases: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response('{}', { status: 200 })
  })
  const utils = render(
    <SolvaPayProvider config={{ fetch: fakeFetch as unknown as typeof fetch }}>
      <PaymentForm planRef="pln_free" productRef="prd_free" {...extraProps} />
    </SolvaPayProvider>,
  )
  return { ...utils, activateCalls, fakeFetch }
}

describe('PaymentForm — free plan routing', () => {
  it('renders a summary + activation button instead of Stripe Elements', async () => {
    renderWith()
    await waitFor(() => expect(screen.getByText('Widget API')).toBeTruthy())
    // The default paid CTA "Pay Now" is NOT rendered; the free CTA uses startUsing.
    expect(screen.queryByText(/Pay Now/)).toBeNull()
    // startUsing: "Start using {product}"
    expect(screen.getByRole('button', { name: /Start using/ })).toBeTruthy()
  })

  it('calls activatePlan and fires onResult({ kind: "activated" }) on submit', async () => {
    const onResult = vi.fn<(r: CheckoutResult) => void>()
    const { activateCalls } = renderWith({ onResult })

    const button = await screen.findByRole('button', { name: /Start using/ })
    fireEvent.click(button)

    await waitFor(() =>
      expect(activateCalls).toEqual([
        { productRef: 'prd_free', planRef: 'pln_free' },
      ]),
    )
    await waitFor(() => expect(onResult).toHaveBeenCalled())
    expect(onResult.mock.calls[0][0].kind).toBe('activated')
  })

  it('uses onFreePlan override when provided (skips automatic activation)', async () => {
    const onFreePlan = vi.fn(async (_plan: Plan) => {})
    const onResult = vi.fn<(r: CheckoutResult) => void>()
    const { activateCalls } = renderWith({ onFreePlan, onResult })

    const button = await screen.findByRole('button', { name: /Start using/ })
    fireEvent.click(button)

    await waitFor(() => expect(onFreePlan).toHaveBeenCalledTimes(1))
    expect(activateCalls).toHaveLength(0)
    await waitFor(() => expect(onResult).toHaveBeenCalled())
    expect(onResult.mock.calls[0][0].kind).toBe('activated')
  })

  it('renders terms checkbox + disables submit until accepted when requireTermsAcceptance', async () => {
    renderWith({ requireTermsAcceptance: true })
    const button = await screen.findByRole('button', { name: /Start using/ })
    expect((button as HTMLButtonElement).disabled).toBe(true)

    const checkbox = screen.getByRole('checkbox')
    fireEvent.click(checkbox)
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
  })
})
