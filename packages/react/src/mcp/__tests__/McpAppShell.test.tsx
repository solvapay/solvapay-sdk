import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import {
  McpAppShell,
  computeVisibleTabs,
  type McpAppShellProps,
} from '../McpAppShell'
import type { McpBootstrap } from '../bootstrap'
import { SolvaPayContext } from '../../SolvaPayProvider'
import { merchantCache } from '../../hooks/useMerchant'
import { createTransportCacheKey } from '../../transport/cache-key'
import type {
  SolvaPayContextValue,
  SolvaPayConfig,
  Merchant,
  PurchaseInfo,
} from '../../types'

function makeTransport(): NonNullable<SolvaPayConfig['transport']> {
  return {
    checkPurchase: vi.fn(),
    createPayment: vi.fn(),
    processPayment: vi.fn(),
    createTopupPayment: vi.fn(),
    getBalance: vi.fn(),
    cancelRenewal: vi.fn(),
    reactivateRenewal: vi.fn(),
    activatePlan: vi.fn(),
    createCheckoutSession: vi.fn(),
    createCustomerSession: vi.fn().mockResolvedValue({ customerUrl: 'https://portal.test' }),
    getMerchant: vi.fn(),
    getProduct: vi.fn(),
    listPlans: vi.fn(),
    getPaymentMethod: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

function seedMerchant(merchant: Merchant | null): SolvaPayConfig {
  const config: SolvaPayConfig = { transport: makeTransport() }
  const key = createTransportCacheKey(config, '/api/merchant')
  merchantCache.set(key, { merchant, promise: null, timestamp: Date.now() })
  return config
}

function buildCtx(
  config: SolvaPayConfig,
  purchases: PurchaseInfo[] = [],
  credits: number | null = null,
): SolvaPayContextValue {
  const active = purchases[0] ?? null
  return {
    purchase: {
      loading: false,
      isRefetching: false,
      error: null,
      purchases,
      hasProduct: () => purchases.length > 0,
      activePurchase: active,
      hasPaidPurchase: !!active && (active.amount ?? 0) > 0,
      activePaidPurchase: active,
      balanceTransactions: [],
      customerRef: 'cus_abc',
      email: 'demo@acme.test',
      name: 'Demo',
    },
    refetchPurchase: vi.fn(),
    createPayment: vi.fn(),
    createTopupPayment: vi.fn(),
    cancelRenewal: vi.fn(),
    reactivateRenewal: vi.fn(),
    activatePlan: vi.fn(),
    balance: {
      loading: false,
      credits,
      displayCurrency: 'USD',
      creditsPerMinorUnit: 100,
      displayExchangeRate: 1,
      refetch: vi.fn(),
      adjustBalance: vi.fn(),
    },
    _config: config,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

const baseBootstrap: McpBootstrap = {
  view: 'checkout',
  productRef: 'prd_x',
  stripePublishableKey: null,
  returnUrl: 'https://example.test/r',
  merchant: { displayName: 'Acme', legalName: 'Acme Inc.' } as never,
  product: { reference: 'prd_x' } as never,
  plans: [],
  customer: null,
}

function renderShell(
  bootstrap: Partial<McpBootstrap>,
  ctx: SolvaPayContextValue,
  props: Partial<McpAppShellProps> = {},
) {
  return render(
    <SolvaPayContext.Provider value={ctx}>
      <McpAppShell
        bootstrap={{ ...baseBootstrap, ...bootstrap }}
        {...props}
      />
    </SolvaPayContext.Provider>,
  )
}

describe('computeVisibleTabs', () => {
  it('shows only Plan when customer is absent and no plans exist', () => {
    const tabs = computeVisibleTabs({ ...baseBootstrap })
    expect(tabs).toEqual(['checkout'])
  })

  it('adds Account when the customer is authenticated', () => {
    const tabs = computeVisibleTabs({
      ...baseBootstrap,
      customer: { ref: 'cus_1', purchase: null, paymentMethod: null, balance: null, usage: null },
    })
    expect(tabs).toContain('account')
  })

  it('adds Top up and Activate when plans include a usage-based plan', () => {
    const tabs = computeVisibleTabs({
      ...baseBootstrap,
      plans: [{ reference: 'pln_ub', planType: 'usage-based' } as never],
    })
    expect(tabs).toContain('topup')
    expect(tabs).toContain('activate')
  })

  it('keeps Credits visible when customer is on an unlimited (recurring, no meter) plan', () => {
    const tabs = computeVisibleTabs({
      ...baseBootstrap,
      customer: {
        ref: 'cus_1',
        purchase: {
          customerRef: 'cus_1',
          purchases: [
            {
              reference: 'pur_u',
              planSnapshot: { planType: 'recurring' },
            },
          ],
        } as never,
        paymentMethod: null,
        balance: null,
        usage: null,
      },
    })
    expect(tabs).toContain('usage')
  })

  it('respects a literal tabs override', () => {
    const tabs = computeVisibleTabs({ ...baseBootstrap }, ['account', 'checkout'])
    expect(tabs).toEqual(['account', 'checkout'])
  })
})

describe('<McpAppShell>', () => {
  beforeEach(() => {
    merchantCache.clear()
  })

  it('renders a tab strip with role=tablist and aria-selected on the active tab', () => {
    const config = seedMerchant({ displayName: 'Acme', legalName: 'Acme Inc.' })
    const ctx = buildCtx(config, [], 0)
    renderShell(
      {
        customer: { ref: 'cus_1', purchase: null, paymentMethod: null, balance: null, usage: null },
        plans: [{ reference: 'pln_ub', planType: 'usage-based' } as never],
      },
      ctx,
    )

    const tablist = screen.getByRole('tablist')
    expect(tablist).toBeTruthy()
    const planTab = screen.getByRole('tab', { name: 'Plan' })
    expect(planTab.getAttribute('aria-selected')).toBe('true')
    const accountTab = screen.getByRole('tab', { name: 'Account' })
    expect(accountTab.getAttribute('aria-selected')).toBe('false')
  })

  it('hides the nav on the paywall view', () => {
    const config = seedMerchant({ displayName: 'Acme', legalName: 'Acme Inc.' })
    const ctx = buildCtx(config, [], 0)
    renderShell(
      {
        view: 'paywall',
        paywall: {
          kind: 'payment_required',
          message: 'Out of credits',
          product: { reference: 'prd_x', name: 'X', description: '', displayName: 'X' },
          checkoutUrl: 'https://example.test/pay',
          plans: [],
        } as never,
      },
      ctx,
    )
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('switches tabs without firing a tool call (refresh under the stale threshold)', () => {
    const onRefresh = vi.fn()
    const config = seedMerchant({ displayName: 'Acme', legalName: 'Acme Inc.' })
    const ctx = buildCtx(config, [], 0)
    renderShell(
      {
        customer: { ref: 'cus_1', purchase: null, paymentMethod: null, balance: null, usage: null },
      },
      ctx,
      { onRefreshBootstrap: onRefresh },
    )

    const accountTab = screen.getByRole('tab', { name: 'Account' })
    act(() => {
      fireEvent.click(accountTab)
    })
    expect(accountTab.getAttribute('aria-selected')).toBe('true')
    // Within the stale threshold — no refresh fired.
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('cycles focus with ArrowRight / ArrowLeft', () => {
    const config = seedMerchant({ displayName: 'Acme', legalName: 'Acme Inc.' })
    const ctx = buildCtx(config, [], 0)
    renderShell(
      {
        customer: { ref: 'cus_1', purchase: null, paymentMethod: null, balance: null, usage: null },
        plans: [{ reference: 'pln_ub', planType: 'usage-based' } as never],
      },
      ctx,
    )
    const planTab = screen.getByRole('tab', { name: 'Plan' })
    planTab.focus()
    act(() => {
      fireEvent.keyDown(planTab, { key: 'ArrowRight' })
    })
    expect(document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent).toContain(
      'Top up',
    )
  })

  it('renders the Upgrade CTA on the paywall when a recurring plan exists', () => {
    const config = seedMerchant({ displayName: 'Acme', legalName: 'Acme Inc.' })
    const ctx = buildCtx(config, [], 0)
    renderShell(
      {
        view: 'paywall',
        plans: [
          { reference: 'pln_u', planType: 'recurring', name: 'Unlimited', price: 10000, currency: 'USD', billingCycle: 'monthly' } as never,
        ],
        paywall: {
          kind: 'payment_required',
          message: 'Out of credits',
          product: { reference: 'prd_x', name: 'X', description: '', displayName: 'X' },
          checkoutUrl: 'https://example.test/pay',
          plans: [],
        } as never,
      },
      ctx,
    )

    const upgradeButton = screen.getByRole('button', { name: /Upgrade to Unlimited/ })
    expect(upgradeButton).toBeTruthy()

    // Clicking it dismisses the paywall and routes to the Plan tab —
    // the tablist re-appears now that we've escaped the gate.
    act(() => {
      fireEvent.click(upgradeButton)
    })
    expect(screen.getByRole('tablist')).toBeTruthy()
    const planTab = screen.getByRole('tab', { name: 'Plan' })
    expect(planTab.getAttribute('aria-selected')).toBe('true')
  })

  it('keeps Credits visible on an unlimited plan and renders an empty-state card', () => {
    const config = seedMerchant({ displayName: 'Acme', legalName: 'Acme Inc.' })
    const unlimitedPurchase: PurchaseInfo = {
      reference: 'pur_u',
      productName: 'Product X',
      status: 'active',
      startDate: '2026-01-01T00:00:00Z',
      amount: 10000,
      currency: 'USD',
      isRecurring: true,
      planSnapshot: {
        planType: 'recurring',
        reference: 'pln_u',
        name: 'Unlimited',
        billingCycle: 'monthly',
      },
    }
    const ctx = buildCtx(config, [unlimitedPurchase], 0)
    renderShell(
      {
        view: 'usage',
        customer: {
          ref: 'cus_1',
          purchase: {
            customerRef: 'cus_1',
            purchases: [
              {
                reference: 'pur_u',
                planSnapshot: { planType: 'recurring' },
              },
            ],
          } as never,
          paymentMethod: null,
          balance: null,
          usage: null,
        },
      },
      ctx,
    )

    expect(screen.getByRole('tab', { name: 'Credits' })).toBeTruthy()
    expect(screen.getByText(/no limits on this plan/i)).toBeTruthy()
  })

  it('renders the Provided by SolvaPay footer when terms/privacy exist', () => {
    const config = seedMerchant({
      displayName: 'Acme',
      legalName: 'Acme Inc.',
      termsUrl: 'https://acme.com/terms',
      privacyUrl: 'https://acme.com/privacy',
    })
    const ctx = buildCtx(config, [], 0)
    renderShell({}, ctx)
    expect(screen.getByText(/Provided by SolvaPay/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Terms' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Privacy' })).toBeTruthy()
  })
})
