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

  it('exposes refreshBootstrap on context', async () => {
    const transport = makeTransport({
      checkPurchase: vi.fn().mockResolvedValue({ customerRef: 'cus_42', purchases: [] }),
    })
    const config: SolvaPayConfig = { transport, initial: makeInitial() }

    let snapshot: unknown
    render(
      <SolvaPayProvider config={config}>
        <Probe onValue={v => (snapshot = v)} />
      </SolvaPayProvider>,
    )

    await waitFor(() => expect(snapshot).toBeTruthy())
    const ctx = snapshot as {
      refreshBootstrap?: () => Promise<void>
    }
    expect(ctx.refreshBootstrap).toBeTypeOf('function')
    await act(async () => {
      await ctx.refreshBootstrap?.()
    })
    expect(transport.checkPurchase).toHaveBeenCalled()
  })
})
