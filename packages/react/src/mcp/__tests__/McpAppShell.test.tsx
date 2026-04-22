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
  view: 'about',
  productRef: 'prd_x',
  stripePublishableKey: null,
  returnUrl: 'https://example.test/r',
  merchant: { displayName: 'Acme', legalName: 'Acme Inc.' } as never,
  product: { reference: 'prd_x', name: 'Acme Knowledge Base' } as never,
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
  it('shows About and Plan by default when customer is absent and no plans exist', () => {
    const tabs = computeVisibleTabs({ ...baseBootstrap })
    expect(tabs).toEqual(['about', 'checkout'])
  })

  it('adds Account when the customer is authenticated', () => {
    const tabs = computeVisibleTabs({
      ...baseBootstrap,
      customer: { ref: 'cus_1', purchase: null, paymentMethod: null, balance: null, usage: null },
    })
    expect(tabs).toContain('account')
    expect(tabs).toContain('about')
    expect(tabs).not.toContain('activate')
  })

  it('adds Top up when plans include a usage-based plan', () => {
    const tabs = computeVisibleTabs({
      ...baseBootstrap,
      plans: [{ reference: 'pln_ub', planType: 'usage-based' } as never],
    })
    expect(tabs).toContain('topup')
    expect(tabs).not.toContain('activate')
  })

  it('About + Plan are always visible (activity strip replaces legacy empty Credits tab)', () => {
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
    expect(tabs).toContain('about')
    expect(tabs).toContain('checkout')
    expect(tabs).toContain('account')
    expect(tabs).not.toContain('usage')
    expect(tabs).not.toContain('activate')
  })

  it('respects a literal tabs override', () => {
    const tabs = computeVisibleTabs({ ...baseBootstrap }, ['account', 'checkout'])
    expect(tabs).toEqual(['account', 'checkout'])
  })

  it("'all' exposes the full legacy tab set for integrators that pin it", () => {
    const tabs = computeVisibleTabs({ ...baseBootstrap }, 'all')
    expect(tabs).toEqual(['about', 'checkout', 'topup', 'account', 'usage', 'activate'])
  })
})

describe('<McpAppShell>', () => {
  beforeEach(() => {
    merchantCache.clear()
  })

  it('renders a tab strip with About as the first tab and aria-selected on the active tab', () => {
    const config = seedMerchant({ displayName: 'Acme', legalName: 'Acme Inc.' })
    const ctx = buildCtx(config, [], 0)
    renderShell(
      {
        view: 'about',
        customer: { ref: 'cus_1', purchase: null, paymentMethod: null, balance: null, usage: null },
        plans: [{ reference: 'pln_ub', planType: 'usage-based' } as never],
      },
      ctx,
    )

    expect(screen.getByRole('tablist')).toBeTruthy()
    const aboutTab = screen.getByRole('tab', { name: 'About' })
    expect(aboutTab.getAttribute('aria-selected')).toBe('true')
    const planTab = screen.getByRole('tab', { name: 'Plan' })
    expect(planTab.getAttribute('aria-selected')).toBe('false')
    expect(screen.queryByRole('tab', { name: 'Activate' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Credits' })).toBeNull()
  })

  it('uses bootstrap.product.name for the shell heading', () => {
    const config = seedMerchant({ displayName: 'Acme', legalName: 'Acme Inc.' })
    const ctx = buildCtx(config, [], 0)
    renderShell({}, ctx)
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading.textContent).toBe('Acme Knowledge Base')
  })

  it('falls back to merchant.displayName when the product has no name', () => {
    const config = seedMerchant({ displayName: 'Acme', legalName: 'Acme Inc.' })
    const ctx = buildCtx(config, [], 0)
    renderShell(
      {
        product: { reference: 'prd_x' } as never,
      },
      ctx,
    )
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading.textContent).toBe('Acme')
  })

  it('surfaces tab hints via title= attributes', () => {
    const config = seedMerchant({ displayName: 'Acme', legalName: 'Acme Inc.' })
    const ctx = buildCtx(config, [], 0)
    renderShell(
      {
        customer: { ref: 'cus_1', purchase: null, paymentMethod: null, balance: null, usage: null },
      },
      ctx,
    )
    const aboutTab = screen.getByRole('tab', { name: 'About' })
    expect(aboutTab.getAttribute('title')).toMatch(/what this app does/i)
    expect(aboutTab.getAttribute('aria-describedby')).toBe('solvapay-mcp-tab-hint-about')
  })

  it('tags each tab button with data-tour-step so the tour can anchor to them', () => {
    const config = seedMerchant({ displayName: 'Acme', legalName: 'Acme Inc.' })
    const ctx = buildCtx(config, [], 0)
    renderShell(
      {
        customer: { ref: 'cus_1', purchase: null, paymentMethod: null, balance: null, usage: null },
      },
      ctx,
    )
    const aboutTab = screen.getByRole('tab', { name: 'About' })
    expect(aboutTab.getAttribute('data-tour-step')).toBe('about')
    const planTab = screen.getByRole('tab', { name: 'Plan' })
    expect(planTab.getAttribute('data-tour-step')).toBe('checkout')
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
        view: 'about',
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
    const aboutTab = screen.getByRole('tab', { name: 'About' })
    aboutTab.focus()
    act(() => {
      fireEvent.keyDown(aboutTab, { key: 'ArrowRight' })
    })
    expect(document.activeElement?.textContent).toContain('Plan')
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

    act(() => {
      fireEvent.click(upgradeButton)
    })
    expect(screen.getByRole('tablist')).toBeTruthy()
    const planTab = screen.getByRole('tab', { name: 'Plan' })
    expect(planTab.getAttribute('aria-selected')).toBe('true')
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
    expect(screen.getByRole('link', { name: /Terms/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Privacy/ })).toBeTruthy()
  })
})
