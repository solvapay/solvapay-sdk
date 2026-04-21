/**
 * Regression coverage for the Phase 0.2 seam fix: ActivationFlow's inline
 * `AmountPicker` shares its selector with the flow's top-level
 * `useTopupAmountSelector` instance, so amounts picked in the sub-picker
 * feed straight into the retry path.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { ActivationFlow, useActivationFlow } from './ActivationFlow'
import { AmountPicker } from './AmountPicker'
import { SolvaPayProvider } from '../SolvaPayProvider'
import { plansCache } from '../hooks/usePlans'
import type { Plan } from '../types'

const usageBasedPlan: Plan = {
  reference: 'pln_usage',
  name: 'Usage plan',
  price: 0,
  currency: 'usd',
  // @ts-expect-error — plan typing is wider than this test fixture needs
  requiresPayment: true,
  planType: 'usage_based',
}

function makeFetch(payload: unknown, status = 200) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

function activatePlanTopupRequired() {
  return vi.fn().mockResolvedValue({
    status: 'topup_required',
    message: 'Need credits to activate',
  })
}

function renderFlow(activateMock: ReturnType<typeof activatePlanTopupRequired>) {
  const fetchFn = makeFetch({ plans: [usageBasedPlan] })
  return render(
    <SolvaPayProvider
      config={{
        fetch: fetchFn as unknown as typeof fetch,
        transport: {
          checkPurchase: vi.fn().mockResolvedValue({ purchases: [] }),
          activatePlan: activateMock,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      }}
    >
      <ActivationFlow.Root productRef="prd_x" planRef="pln_usage">
        <ActivationFlow.ActivateButton data-testid="activate" />

        <ActivationFlow.AmountPicker>
          <AmountPicker.Option amount={50} data-testid="pill-50" />
          <AmountPicker.Option amount={100} data-testid="pill-100" />
        </ActivationFlow.AmountPicker>
        <ActivationFlow.ContinueButton data-testid="continue" />

        <ActivationFlow.Retrying>
          <p data-testid="retrying">retrying</p>
        </ActivationFlow.Retrying>

        <FlowSelectorAmount />
      </ActivationFlow.Root>
    </SolvaPayProvider>,
  )
}

/**
 * Exposes the flow's shared selector's `resolvedAmount` so the test can
 * assert that the inline `AmountPicker.Option` wrote into the flow
 * selector and not an isolated instance.
 */
function FlowSelectorAmount() {
  const flow = useActivationFlow()
  return (
    <span data-testid="picked-amount">{flow.amountSelector.resolvedAmount ?? ''}</span>
  )
}

beforeEach(() => {
  plansCache.clear()
})

describe('ActivationFlow selector sharing (phase 0.2)', () => {
  it('inline AmountPicker.Option writes into the flow selector, not an isolated instance', async () => {
    const activateMock = activatePlanTopupRequired()
    renderFlow(activateMock)

    fireEvent.click(await screen.findByTestId('activate'))
    await waitFor(() => expect(activateMock).toHaveBeenCalledTimes(1))

    const pill = await screen.findByTestId('pill-50')
    fireEvent.click(pill)

    // After the pill click, the shared selector should expose the picked
    // amount — this is the regression: pre-fix, the inner picker had its
    // own selector and this would stay null.
    await waitFor(() => expect(screen.getByTestId('picked-amount').textContent).toBe('50'))

    // Continue triggers goToTopupPayment -> topupPayment step. We don't
    // run the full retry path here (no Stripe), but the selector state
    // flowing through proves the fix.
    fireEvent.click(screen.getByTestId('continue'))
  })
})

describe('ActivationFlow amountMinor (zero-decimal currencies)', () => {
  function renderFlowForCurrency(currency: string) {
    const fetchFn = makeFetch({ plans: [{ ...usageBasedPlan, currency }] })
    return render(
      <SolvaPayProvider
        config={{
          fetch: fetchFn as unknown as typeof fetch,
          transport: {
            checkPurchase: vi.fn().mockResolvedValue({ purchases: [] }),
            activatePlan: activatePlanTopupRequired(),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
        }}
      >
        <ActivationFlow.Root productRef="prd_x" planRef="pln_usage">
          <ActivationFlow.ActivateButton data-testid="activate" />
          <ActivationFlow.AmountPicker>
            <AmountPicker.Option amount={1000} data-testid="pill-1000" />
          </ActivationFlow.AmountPicker>
          <FlowAmountMinor />
          <FlowAmountCents />
        </ActivationFlow.Root>
      </SolvaPayProvider>,
    )
  }

  function FlowAmountMinor() {
    const flow = useActivationFlow()
    return <span data-testid="amount-minor">{flow.amountMinor}</span>
  }

  function FlowAmountCents() {
    const flow = useActivationFlow()
    return <span data-testid="amount-cents">{flow.amountCents}</span>
  }

  it('treats JPY amounts as whole yen, not yen×100', async () => {
    renderFlowForCurrency('jpy')

    fireEvent.click(await screen.findByTestId('activate'))
    fireEvent.click(await screen.findByTestId('pill-1000'))

    // JPY is zero-decimal: picked 1000 should surface as 1000 minor units,
    // not 100000 (the pre-fix `* 100` behaviour).
    await waitFor(() => expect(screen.getByTestId('amount-minor').textContent).toBe('1000'))
    // Deprecated alias mirrors amountMinor for back-compat.
    expect(screen.getByTestId('amount-cents').textContent).toBe('1000')
  })

  it('keeps USD amounts in cents (×100)', async () => {
    renderFlowForCurrency('usd')

    fireEvent.click(await screen.findByTestId('activate'))
    fireEvent.click(await screen.findByTestId('pill-1000'))

    await waitFor(() =>
      expect(screen.getByTestId('amount-minor').textContent).toBe('100000'),
    )
  })
})
