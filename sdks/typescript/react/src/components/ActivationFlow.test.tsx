import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import React from 'react'
import { ActivationFlow as ShimActivationFlow } from './ActivationFlow'
import { ActivationFlow, useActivationFlow } from '../primitives/ActivationFlow'
import { AmountPicker } from '../primitives/AmountPicker'
import { SolvaPayProvider } from '../SolvaPayProvider'
import { plansCache } from '../hooks/usePlans'
import { productCache } from '../hooks/useProduct'
import { useBalance } from '../hooks/useBalance'
import { makeProviderInitial } from '../test-helpers/makeProviderInitial'
import { MissingProviderError, MissingProductRefError } from '../utils/errors'
import type { ActivationResult, Plan, SolvaPayConfig } from '../types'

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

function providerConfig(fetchFn: ReturnType<typeof vi.fn>): SolvaPayConfig {
  return {
    fetch: fetchFn as unknown as typeof fetch,
    initial: makeProviderInitial({ customerRef: 'cus_test' }),
  }
}

function makeFakeFetch(
  responses: Array<{ status: string } & Record<string, unknown>>,
  credits = 0,
) {
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
    if (url.includes('/api/customer-balance')) {
      return new Response(JSON.stringify({ credits }), {
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
  it('summary → activating → activated when the wallet is funded', async () => {
    const { fetchFn, activateCalls } = makeFakeFetch(
      [{ status: 'activated', productRef: 'prd_usage', planRef: 'pln_usage' }],
      500,
    )
    const onSuccess = vi.fn<(r: ActivationResult) => void>()
    render(
      <SolvaPayProvider config={providerConfig(fetchFn)}>
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

  it('summary → activating → activated + zero balance → selectAmount', async () => {
    const { fetchFn } = makeFakeFetch(
      [{ status: 'activated', productRef: 'prd_usage', planRef: 'pln_usage' }],
      0,
    )
    const onSuccess = vi.fn<(r: ActivationResult) => void>()
    render(
      <SolvaPayProvider config={providerConfig(fetchFn)}>
        <ShimActivationFlow productRef="prd_usage" planRef="pln_usage" onSuccess={onSuccess} />
      </SolvaPayProvider>,
    )

    await screen.findByText('Confirm your plan')
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }))

    await waitFor(() => expect(screen.getByText('Add credits')).toBeTruthy())
    expect(screen.getByText('Top up your credits to start using this plan.')).toBeTruthy()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('summary → activating → topup_required → selectAmount', async () => {
    const { fetchFn } = makeFakeFetch([
      { status: 'topup_required', productRef: 'prd_usage', planRef: 'pln_usage' },
    ])
    render(
      <SolvaPayProvider config={providerConfig(fetchFn)}>
        <ShimActivationFlow productRef="prd_usage" planRef="pln_usage" />
      </SolvaPayProvider>,
    )

    await screen.findByText('Confirm your plan')
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }))

    await waitFor(() => expect(screen.getByText('Add credits')).toBeTruthy())
    expect(screen.getByText('Top up your credits to start using this plan.')).toBeTruthy()
    expect(screen.getByText('Continue to payment')).toBeTruthy()
  })

  it('error state shows Try Again and resets to summary', async () => {
    const { fetchFn } = makeFakeFetch([{ status: 'invalid', message: 'Invalid plan config' }])
    render(
      <SolvaPayProvider config={providerConfig(fetchFn)}>
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
      <SolvaPayProvider config={providerConfig(fetchFn)}>
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
      <SolvaPayProvider config={providerConfig(fetchFn)}>
        <ActivationFlow.Root productRef="prd_usage" planRef="pln_usage" data-testid="root">
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
      <SolvaPayProvider config={providerConfig(fetchFn)}>
        <ActivationFlow.Root productRef="prd_usage" planRef="pln_usage">
          <Probe />
        </ActivationFlow.Root>
      </SolvaPayProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('plan').textContent).toBe('pln_usage'))
    expect(screen.getByTestId('step').textContent).toBe('summary')
  })

  it('stays on topupPayment when a zero-credit balance refetch re-fires activation', async () => {
    const { fetchFn } = makeFakeFetch(
      [{ status: 'activated', productRef: 'prd_usage', planRef: 'pln_usage' }],
      0,
    )

    function Harness() {
      const [tick, setTick] = React.useState(0)
      const { refetch } = useBalance()
      return (
        <ActivationFlow.Root
          productRef="prd_usage"
          planRef="pln_usage"
          onSuccess={() => {
            void tick
          }}
          data-testid="root"
        >
          <ActivationFlow.ActivateButton data-testid="activate" />
          <ActivationFlow.AmountPicker>
            <AmountPicker.Option amount={50} data-testid="pill-50" />
          </ActivationFlow.AmountPicker>
          <ActivationFlow.ContinueButton data-testid="continue" />
          <span data-testid="refetch-tick">{tick}</span>
          <button
            type="button"
            data-testid="refetch-balance"
            onClick={() => {
              void refetch().then(() => setTick(value => value + 1))
            }}
          >
            refetch
          </button>
        </ActivationFlow.Root>
      )
    }

    render(
      <SolvaPayProvider config={providerConfig(fetchFn)}>
        <Harness />
      </SolvaPayProvider>,
    )

    fireEvent.click(await screen.findByTestId('activate'))
    await waitFor(() =>
      expect(screen.getByTestId('root').getAttribute('data-state')).toBe('selectAmount'),
    )

    fireEvent.click(screen.getByTestId('pill-50'))
    await waitFor(() => expect(screen.getByTestId('continue')).not.toBeDisabled())
    fireEvent.click(screen.getByTestId('continue'))
    await waitFor(() =>
      expect(screen.getByTestId('root').getAttribute('data-state')).toBe('topupPayment'),
    )

    fireEvent.click(screen.getByTestId('refetch-balance'))
    await waitFor(() => expect(screen.getByTestId('refetch-tick').textContent).toBe('1'))

    expect(screen.getByTestId('root').getAttribute('data-state')).toBe('topupPayment')
    expect(screen.queryByTestId('continue')).toBeNull()
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
