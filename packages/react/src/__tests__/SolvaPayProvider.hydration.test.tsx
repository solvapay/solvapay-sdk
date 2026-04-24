/**
 * Hydration tests for `SolvaPayProvider` — when `config.initial` is
 * present the provider mounts with the snapshot applied and skips the
 * first-mount `checkPurchase` fetch.
 */

import React, { useContext } from 'react'
import { act, render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SolvaPayContext, SolvaPayProvider } from '../SolvaPayProvider'
import type { SolvaPayConfig, SolvaPayProviderInitial } from '../types'
import type { SolvaPayTransport } from '../transport/types'

function makeTransport(overrides: Partial<SolvaPayTransport> = {}): SolvaPayTransport {
  return {
    checkPurchase: vi.fn(),
    createPayment: vi.fn(),
    processPayment: vi.fn(),
    createTopupPayment: vi.fn(),
    getBalance: vi.fn().mockResolvedValue({
      credits: 0,
      displayCurrency: 'USD',
      creditsPerMinorUnit: 1,
      displayExchangeRate: 1,
    }),
    cancelRenewal: vi.fn(),
    reactivateRenewal: vi.fn(),
    activatePlan: vi.fn(),
    createCheckoutSession: vi.fn(),
    createCustomerSession: vi.fn(),
    getMerchant: vi.fn(),
    getProduct: vi.fn(),
    listPlans: vi.fn(),
    getPaymentMethod: vi.fn(),
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

function makeInitial(
  overrides: Partial<SolvaPayProviderInitial> = {},
): SolvaPayProviderInitial {
  return {
    customerRef: 'cus_42',
    purchase: {
      customerRef: 'cus_42',
      email: 'a@b.test',
      purchases: [],
    },
    paymentMethod: { kind: 'none' },
    balance: {
      customerRef: 'cus_42',
      credits: 500,
      displayCurrency: 'USD',
      creditsPerMinorUnit: 1,
      displayExchangeRate: 1,
    },
    usage: null,
    merchant: { displayName: 'Acme', legalName: 'Acme Inc' },
    product: { reference: 'prd_test' },
    plans: [],
    ...overrides,
  }
}

function Probe({ onValue }: { onValue: (v: unknown) => void }) {
  const value = useContext(SolvaPayContext)
  React.useEffect(() => {
    onValue(value)
  }, [value, onValue])
  return null
}

describe('SolvaPayProvider hydration from config.initial', () => {
  it('seeds purchase + customerRef + balance without calling transport.checkPurchase', async () => {
    const transport = makeTransport()
    const config: SolvaPayConfig = { transport, initial: makeInitial() }

    let snapshot: unknown
    render(
      <SolvaPayProvider config={config}>
        <Probe onValue={v => (snapshot = v)} />
      </SolvaPayProvider>,
    )

    await waitFor(() => expect(snapshot).toBeTruthy())
    const ctx = snapshot as {
      purchase: { loading: boolean; customerRef?: string }
      balance: { credits: number | null; loading: boolean }
      customerRef?: string
    }

    expect(transport.checkPurchase).not.toHaveBeenCalled()
    expect(ctx.customerRef).toBe('cus_42')
    expect(ctx.purchase.loading).toBe(false)
    expect(ctx.balance.credits).toBe(500)
    expect(ctx.balance.loading).toBe(false)
  })

  it('exposes refreshBootstrap that falls back to refetchPurchase in HTTP mode', async () => {
    const transport = makeTransport({
      checkPurchase: vi.fn().mockResolvedValue({ customerRef: 'cus_42', purchases: [] }),
    })
    // Provide an auth adapter so `isAuthenticated` flips true and the
    // HTTP-path `refetchPurchase` actually reaches `transport.checkPurchase`.
    // No `initial` / `refreshInitial` — HTTP-transport code path.
    const config: SolvaPayConfig = {
      transport,
      auth: {
        adapter: {
          getToken: async () => 'http-session',
          getUserId: async () => 'user_1',
        },
      },
    }

    let snapshot: unknown
    render(
      <SolvaPayProvider config={config}>
        <Probe onValue={v => (snapshot = v)} />
      </SolvaPayProvider>,
    )

    await waitFor(() => expect((snapshot as { purchase?: { loading: boolean } })?.purchase))
    await waitFor(() => expect(transport.checkPurchase).toHaveBeenCalled())

    const ctx = snapshot as { refreshBootstrap?: () => Promise<void> }
    ;(transport.checkPurchase as ReturnType<typeof vi.fn>).mockClear()
    await act(async () => {
      await ctx.refreshBootstrap?.()
    })
    expect(transport.checkPurchase).toHaveBeenCalled()
  })

  it('refreshBootstrap re-applies the snapshot returned by config.refreshInitial (MCP mode)', async () => {
    const transport = makeTransport()
    const refreshed = makeInitial({
      customerRef: 'cus_42',
      balance: {
        customerRef: 'cus_42',
        credits: 999,
        displayCurrency: 'USD',
        creditsPerMinorUnit: 1,
        displayExchangeRate: 1,
      },
    })
    const refreshInitial = vi.fn().mockResolvedValue(refreshed)
    const config: SolvaPayConfig = {
      transport,
      initial: makeInitial(),
      refreshInitial,
    }

    let snapshot: unknown
    render(
      <SolvaPayProvider config={config}>
        <Probe onValue={v => (snapshot = v)} />
      </SolvaPayProvider>,
    )

    await waitFor(() => expect(snapshot).toBeTruthy())
    const getCtx = () =>
      snapshot as {
        refreshBootstrap?: () => Promise<void>
        balance: { credits: number | null }
      }
    expect(getCtx().balance.credits).toBe(500)

    await act(async () => {
      await getCtx().refreshBootstrap?.()
    })

    expect(refreshInitial).toHaveBeenCalledTimes(1)
    expect(transport.checkPurchase).not.toHaveBeenCalled()
    expect(getCtx().balance.credits).toBe(999)
  })

  it('refetchPurchase replays refreshInitial in MCP mode so consumers observe fresh purchase state', async () => {
    // Regression: without this routing, `refetchPurchase()` is a no-op
    // on MCP transports (no `checkPurchase`). `<PaymentForm>`'s
    // post-confirmation polling would then time out against stale state
    // and surface "Payment processing timed out — webhooks may not be
    // configured" even when the webhook already completed the purchase.
    const transport = makeTransport({ checkPurchase: undefined })
    const refreshed = makeInitial({
      purchase: {
        customerRef: 'cus_42',
        email: 'a@b.test',
        purchases: [
          {
            reference: 'pur_new',
            status: 'active',
            productName: 'Pro',
            productRef: 'prd_test',
            planRef: 'pln_pro',
            planName: 'Pro',
            amount: 1000,
            currency: 'USD',
            startDate: new Date().toISOString(),
            planSnapshot: { reference: 'pln_pro', name: 'Pro' },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
        ],
      },
    })
    const refreshInitial = vi.fn().mockResolvedValue(refreshed)
    const config: SolvaPayConfig = {
      transport,
      initial: makeInitial(),
      refreshInitial,
    }

    let snapshot: unknown
    render(
      <SolvaPayProvider config={config}>
        <Probe onValue={v => (snapshot = v)} />
      </SolvaPayProvider>,
    )

    await waitFor(() => expect(snapshot).toBeTruthy())
    const getCtx = () =>
      snapshot as {
        refetchPurchase: () => Promise<void>
        purchase: { hasPaidPurchase: boolean }
      }

    expect(getCtx().purchase.hasPaidPurchase).toBe(false)

    await act(async () => {
      await getCtx().refetchPurchase()
    })

    expect(refreshInitial).toHaveBeenCalledTimes(1)
    expect(transport.checkPurchase).toBeUndefined()
    expect(getCtx().purchase.hasPaidPurchase).toBe(true)
  })
})
