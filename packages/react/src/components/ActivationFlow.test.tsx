import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import React from 'react'
import { ActivationFlow as ShimActivationFlow } from './ActivationFlow'
import { ActivationFlow, useActivationFlow } from '../primitives/ActivationFlow'
import { SolvaPayProvider } from '../SolvaPayProvider'
import { plansCache } from '../hooks/usePlans'
import { productCache } from '../hooks/useProduct'
import { MissingProviderError, MissingProductRefError } from '../utils/errors'
import type { ActivationResult, Plan } from '../types'

const usagePlan: Plan = {
  reference: 'pln_usage',
  name: 'Usage Plan',
  currency: 'usd',
  type: 'usage-based',
  billingModel: 'pre-paid',
  creditsPerUnit: 100,
  measures: 'call',
  requiresPayment: true,
}

type ActivateCall = { productRef: string; planRef: string }

function makeFakeFetch(responses: Array<{ status: string } & Record<string, unknown>>) {
  const activateCalls: ActivateCall[] = []
  let activateIndex = 0
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (url.includes('/api/activate-plan')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as ActivateCall
      activateCalls.push(body)
      const payload = responses[activateIndex] ?? responses[responses.length - 1]
      activateIndex++
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url.includes('/api/check-purchase')) {
      return new Response(JSON.stringify({ purchases: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response('{}', { status: 200 })
  })
  return { fetchFn, activateCalls }
}

beforeEach(() => {
  plansCache.clear()
  productCache.clear()
  plansCache.set('prd_usage', { plans: [usagePlan], timestamp: Date.now(), promise: null })
  productCache.set('prd_usage', {
    product: { reference: 'prd_usage', name: 'Metered API' },
    promise: null,
    timestamp: Date.now(),
  })
})

describe('ActivationFlow (default-tree shim) — state machine', () => {
  it('summary → activating → activated', async () => {
    const { fetchFn, activateCalls } = makeFakeFetch([
      { status: 'activated', productRef: 'prd_usage', planRef: 'pln_usage' },
    ])
    const onSuccess = vi.fn<(r: ActivationResult) => void>()
    render(
      <SolvaPayProvider config={{ fetch: fetchFn as unknown as typeof fetch }}>
        <ShimActivationFlow productRef="prd_usage" planRef="pln_usage" onSuccess={onSuccess} />
      </SolvaPayProvider>,
    )

    await screen.findByText('Confirm your plan')
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }))

    await waitFor(() => expect(activateCalls).toHaveLength(1))
    await waitFor(() => expect(screen.getByText('Plan selected')).toBeTruthy())
    expect(onSuccess).toHaveBeenCalled()
    expect(onSuccess.mock.calls[0][0].kind).toBe('activated')
  })

  it('summary → activating → topup_required → selectAmount', async () => {
    const { fetchFn } = makeFakeFetch([
      { status: 'topup_required', productRef: 'prd_usage', planRef: 'pln_usage' },
    ])
    render(
      <SolvaPayProvider config={{ fetch: fetchFn as unknown as typeof fetch }}>
        <ShimActivationFlow productRef="prd_usage" planRef="pln_usage" />
      </SolvaPayProvider>,
    )

    await screen.findByText('Confirm your plan')
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }))

    await waitFor(() => expect(screen.getByText('Add credits')).toBeTruthy())
    expect(screen.getByText('Top up your credits to activate this plan.')).toBeTruthy()
    expect(screen.getByText('Continue to payment')).toBeTruthy()
  })

  it('error state shows Try Again and resets to summary', async () => {
    const { fetchFn } = makeFakeFetch([
      { status: 'invalid', message: 'Invalid plan config' },
    ])
    render(
      <SolvaPayProvider config={{ fetch: fetchFn as unknown as typeof fetch }}>
        <ShimActivationFlow productRef="prd_usage" planRef="pln_usage" />
      </SolvaPayProvider>,
    )

    await screen.findByText('Confirm your plan')
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }))

    await waitFor(() => expect(screen.getByText('Invalid plan config')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }))
    await waitFor(() => expect(screen.getByText('Confirm your plan')).toBeTruthy())
  })

  it('onBack fires from the summary step', async () => {
    const { fetchFn } = makeFakeFetch([
      { status: 'activated', productRef: 'prd_usage', planRef: 'pln_usage' },
    ])
    const onBack = vi.fn()
    render(
      <SolvaPayProvider config={{ fetch: fetchFn as unknown as typeof fetch }}>
        <ShimActivationFlow productRef="prd_usage" planRef="pln_usage" onBack={onBack} />
      </SolvaPayProvider>,
    )

    await screen.findByText('Confirm your plan')
    fireEvent.click(screen.getByRole('button', { name: /Back to plan selection/ }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})

describe('ActivationFlow primitive', () => {
  it('Root emits data-state=summary and subcomponents gate by step', async () => {
    const { fetchFn } = makeFakeFetch([
      { status: 'activated', productRef: 'prd_usage', planRef: 'pln_usage' },
    ])
    render(
      <SolvaPayProvider config={{ fetch: fetchFn as unknown as typeof fetch }}>
        <ActivationFlow.Root
          productRef="prd_usage"
          planRef="pln_usage"
          data-testid="root"
        >
          <ActivationFlow.Summary data-testid="summary" />
          <ActivationFlow.ActivateButton data-testid="activate" />
          <ActivationFlow.Activated data-testid="activated" />
        </ActivationFlow.Root>
      </SolvaPayProvider>,
    )
    const root = screen.getByTestId('root')
    await waitFor(() => expect(root.getAttribute('data-state')).toBe('summary'))
    expect(screen.getByTestId('summary')).toBeTruthy()
    expect(screen.getByTestId('activate').getAttribute('data-state')).toBe('idle')
    expect(screen.queryByTestId('activated')).toBeNull()
  })

  it('useActivationFlow exposes step + plan for custom trees', async () => {
    const { fetchFn } = makeFakeFetch([
      { status: 'activated', productRef: 'prd_usage', planRef: 'pln_usage' },
    ])
    const Probe = () => {
      const { step, plan } = useActivationFlow()
      return (
        <div>
          <span data-testid="step">{step}</span>
          <span data-testid="plan">{plan?.reference ?? 'none'}</span>
        </div>
      )
    }
    render(
      <SolvaPayProvider config={{ fetch: fetchFn as unknown as typeof fetch }}>
        <ActivationFlow.Root productRef="prd_usage" planRef="pln_usage">
          <Probe />
        </ActivationFlow.Root>
      </SolvaPayProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('plan').textContent).toBe('pln_usage'))
    expect(screen.getByTestId('step').textContent).toBe('summary')
  })

  it('throws MissingProviderError outside SolvaPayProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      render(
        <ActivationFlow.Root productRef="prd_usage" planRef="pln_usage">
          <ActivationFlow.Summary />
        </ActivationFlow.Root>,
      ),
    ).toThrow(MissingProviderError)
    spy.mockRestore()
  })

  it('throws MissingProductRefError when productRef is omitted', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      render(
        <SolvaPayProvider config={{}}>
          <ActivationFlow.Root>
            <ActivationFlow.Summary />
          </ActivationFlow.Root>
        </SolvaPayProvider>,
      ),
    ).toThrow(MissingProductRefError)
    spy.mockRestore()
  })
})
