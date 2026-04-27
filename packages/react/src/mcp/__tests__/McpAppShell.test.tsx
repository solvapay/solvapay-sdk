import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { McpAppShell, type McpAppShellProps } from '../McpAppShell'
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
  view: 'account',
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

describe('<McpAppShell>', () => {
  beforeEach(() => {
    merchantCache.clear()
  })

  it('renders no tab strip — the surface is locked by bootstrap.view', () => {
    const config = seedMerchant({ displayName: 'Acme', legalName: 'Acme Inc.' })
    const ctx = buildCtx(config, [], 0)
    renderShell(
      {
        view: 'account',
        customer: { ref: 'cus_1', purchase: null, paymentMethod: null, balance: null, usage: null },
      },
      ctx,
    )
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByRole('tabpanel')).toBeNull()
  })

  it('routes `view: "checkout"` to the override component', () => {
    const config = seedMerchant({ displayName: 'Acme', legalName: 'Acme Inc.' })
    const ctx = buildCtx(config, [], 0)
    const Checkout = vi.fn(() => <div data-testid="checkout-stub" />)
    renderShell({ view: 'checkout' }, ctx, { views: { checkout: Checkout } })
    expect(screen.getByTestId('checkout-stub')).toBeTruthy()
  })

  it('routes `view: "topup"` to the override component', () => {
    const config = seedMerchant({ displayName: 'Acme', legalName: 'Acme Inc.' })
    const ctx = buildCtx(config, [], 0)
    const Topup = vi.fn(() => <div data-testid="topup-stub" />)
    renderShell({ view: 'topup' }, ctx, { views: { topup: Topup } })
    expect(screen.getByTestId('topup-stub')).toBeTruthy()
  })

  it('routes `view: "account"` to the override component', () => {
    const config = seedMerchant({ displayName: 'Acme', legalName: 'Acme Inc.' })
    const ctx = buildCtx(config, [], 0)
    const Account = vi.fn(() => <div data-testid="account-stub" />)
    renderShell(
      {
        view: 'account',
        customer: { ref: 'cus_1', purchase: null, paymentMethod: null, balance: null, usage: null },
      },
      ctx,
      { views: { account: Account } },
    )
    expect(screen.getByTestId('account-stub')).toBeTruthy()
  })

  it('legacy `view: "about"` / `"activate"` / `"usage"` bootstraps collapse to surviving surfaces', () => {
    const config = seedMerchant({ displayName: 'Acme', legalName: 'Acme Inc.' })
    const ctx = buildCtx(config, [], 0)
    const Checkout = vi.fn(() => <div data-testid="checkout-stub" />)
    const Account = vi.fn(() => <div data-testid="account-stub" />)
    // `'about'` → checkout
    const { rerender } = render(
      <SolvaPayContext.Provider value={ctx}>
        <McpAppShell
          bootstrap={{ ...baseBootstrap, view: 'about' as never }}
          views={{ checkout: Checkout, account: Account }}
        />
      </SolvaPayContext.Provider>,
    )
    expect(screen.getByTestId('checkout-stub')).toBeTruthy()

    // `'activate'` → checkout
    rerender(
      <SolvaPayContext.Provider value={ctx}>
        <McpAppShell
          bootstrap={{ ...baseBootstrap, view: 'activate' as never }}
          views={{ checkout: Checkout, account: Account }}
        />
      </SolvaPayContext.Provider>,
    )
    expect(screen.getByTestId('checkout-stub')).toBeTruthy()

    // `'usage'` → account
    rerender(
      <SolvaPayContext.Provider value={ctx}>
        <McpAppShell
          bootstrap={{
            ...baseBootstrap,
            view: 'usage' as never,
            customer: { ref: 'cus_1', purchase: null, paymentMethod: null, balance: null, usage: null },
          }}
          views={{ checkout: Checkout, account: Account }}
        />
      </SolvaPayContext.Provider>,
    )
    expect(screen.getByTestId('account-stub')).toBeTruthy()
  })

  it('defaults to the account surface when bootstrap.view is undefined', () => {
    const config = seedMerchant({ displayName: 'Acme', legalName: 'Acme Inc.' })
    const ctx = buildCtx(config, [], 0)
    renderShell(
      {
        // @ts-expect-error — stress the undefined fallback path.
        view: undefined,
        customer: { ref: 'cus_1', purchase: null, paymentMethod: null, balance: null, usage: null },
      },
      ctx,
    )
    // Account view renders the sidebar's Details cards, not the
    // Checkout picker — assert via the "Your account context" aside.
    expect(screen.getByLabelText('Your account context')).toBeTruthy()
  })

  it('no longer renders a shell-level brand header — branding moved to <McpApp>-level <AppHeader>', () => {
    // The old `<ShellHeader>` painted logo + brand name + product h1
    // above the view. `<AppHeader>` now renders once in `<McpApp>` as
    // a chrome row above the shell so every surface (loading, error,
    // checkout, account, topup) shares one merchant mark, and hosts
    // that paint their own merchant chrome (ChatGPT, Claude Desktop)
    // can suppress it while MCP Jam / VS Code keep the in-widget mark.
    const config = seedMerchant({
      displayName: 'Acme',
      legalName: 'Acme Inc.',
      logoUrl: 'https://acme.test/logo.png',
    })
    const ctx = buildCtx(config, [], 0)
    const { container } = renderShell({}, ctx)
    expect(container.querySelector('.solvapay-mcp-shell-header')).toBeNull()
    expect(container.querySelector('.solvapay-mcp-shell-brand')).toBeNull()
    expect(container.querySelector('.solvapay-mcp-shell-logo')).toBeNull()
    expect(container.querySelector('.solvapay-mcp-shell-title')).toBeNull()
    expect(container.querySelector('.solvapay-mcp-shell-tagline')).toBeNull()
  })

  it('threads bootstrap.product into the account view as the surface heading', () => {
    const config = seedMerchant({ displayName: 'Acme', legalName: 'Acme Inc.' })
    const ctx = buildCtx(config, [], 0)
    renderShell(
      {
        view: 'account',
        product: {
          reference: 'prd_x',
          name: 'Acme Knowledge Base',
          description: 'Search Acme docs from anywhere.',
        } as never,
        customer: { ref: 'cus_1', purchase: null, paymentMethod: null, balance: null, usage: null },
      },
      ctx,
    )
    expect(
      screen.getByRole('heading', { level: 1, name: 'Acme Knowledge Base' }),
    ).toBeTruthy()
    expect(screen.getByText('Search Acme docs from anywhere.')).toBeTruthy()
  })

  it('renders the SolvaPay legal footer with solvapay.com legal URLs', () => {
    const config = seedMerchant({
      displayName: 'Acme',
      legalName: 'Acme Inc.',
      termsUrl: 'https://acme.com/terms',
      privacyUrl: 'https://acme.com/privacy',
    })
    const ctx = buildCtx(config, [], 0)
    renderShell({}, ctx)
    const terms = screen.getByRole('link', { name: 'Terms' })
    const privacy = screen.getByRole('link', { name: 'Privacy' })
    expect(terms.getAttribute('href')).toBe('https://solvapay.com/legal/terms')
    expect(privacy.getAttribute('href')).toBe('https://solvapay.com/legal/privacy')
    expect(screen.getByRole('link', { name: 'Provided by SolvaPay' })).toBeTruthy()
  })

  it('renders the SolvaPay legal footer even when the merchant has no terms/privacy URLs', () => {
    const config = seedMerchant({ displayName: 'Acme', legalName: 'Acme Inc.' })
    const ctx = buildCtx(config, [], 0)
    renderShell({}, ctx)
    expect(screen.getByRole('link', { name: 'Terms' }).getAttribute('href')).toBe(
      'https://solvapay.com/legal/terms',
    )
    expect(screen.getByRole('link', { name: 'Privacy' }).getAttribute('href')).toBe(
      'https://solvapay.com/legal/privacy',
    )
    expect(screen.getByRole('link', { name: 'Provided by SolvaPay' })).toBeTruthy()
  })

  it('calls onRefreshBootstrap once on mount', async () => {
    const config = seedMerchant({ displayName: 'Acme', legalName: 'Acme Inc.' })
    const ctx = buildCtx(config, [], 0)
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    renderShell(
      {
        view: 'account',
        customer: { ref: 'cus_1', purchase: null, paymentMethod: null, balance: null, usage: null },
      },
      ctx,
      { onRefreshBootstrap: onRefresh },
    )
    await act(async () => {
      // wait a tick so the mount effect flushes.
      await Promise.resolve()
    })
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('emits no tour anchors (data-tour-step gone)', () => {
    const config = seedMerchant({ displayName: 'Acme', legalName: 'Acme Inc.' })
    const ctx = buildCtx(config, [], 0)
    const { container } = renderShell(
      {
        customer: { ref: 'cus_1', purchase: null, paymentMethod: null, balance: null, usage: null },
      },
      ctx,
    )
    expect(container.querySelector('[data-tour-step]')).toBeNull()
  })

  it('change-plan from the account view routes to the checkout surface', () => {
    const config = seedMerchant({ displayName: 'Acme', legalName: 'Acme Inc.' })
    const ctx = buildCtx(config, [], 0)
    const Account = vi.fn((props: { onChangePlan?: () => void }) => (
      <div>
        <button type="button" data-testid="change-plan" onClick={props.onChangePlan}>
          See plans
        </button>
      </div>
    ))
    const Checkout = vi.fn(() => <div data-testid="checkout-stub" />)
    renderShell(
      {
        view: 'account',
        customer: { ref: 'cus_1', purchase: null, paymentMethod: null, balance: null, usage: null },
      },
      ctx,
      { views: { account: Account, checkout: Checkout } },
    )
    act(() => {
      fireEvent.click(screen.getByTestId('change-plan'))
    })
    expect(screen.getByTestId('checkout-stub')).toBeTruthy()
  })

  it('forwards `onClose` to the checkout view', () => {
    const config = seedMerchant({ displayName: 'Acme', legalName: 'Acme Inc.' })
    const ctx = buildCtx(config, [], 0)
    const onClose = vi.fn()
    const Checkout = vi.fn((props: { onClose?: () => void }) => (
      <button type="button" data-testid="checkout-close" onClick={props.onClose}>
        close
      </button>
    ))
    renderShell({ view: 'checkout' }, ctx, {
      views: { checkout: Checkout },
      onClose,
    })
    act(() => {
      fireEvent.click(screen.getByTestId('checkout-close'))
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
