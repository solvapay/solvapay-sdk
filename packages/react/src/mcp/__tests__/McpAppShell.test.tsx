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

  it('paywall takeover renders `<McpPaywallView>` regardless of the customer field', () => {
    const config = seedMerchant({ displayName: 'Acme', legalName: 'Acme Inc.' })
    const ctx = buildCtx(config, [], 0)
    const Paywall = vi.fn(() => <div data-testid="paywall-stub" />)
    renderShell(
      {
        view: 'paywall',
        // Authenticated customer would normally enable the sidebar,
        // but the paywall takeover should suppress chrome regardless.
        customer: { ref: 'cus_1', purchase: null, paymentMethod: null, balance: null, usage: null },
        paywall: {
          kind: 'payment_required',
          message: 'Out of credits',
          product: { reference: 'prd_x', name: 'X', description: '', displayName: 'X' },
          checkoutUrl: 'https://example.test/pay',
          plans: [],
        } as never,
      },
      ctx,
      { views: { paywall: Paywall } },
    )
    expect(screen.getByTestId('paywall-stub')).toBeTruthy()
    expect(screen.queryByLabelText('Your account context')).toBeNull()
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

  it('renders the in-iframe brand header (logo + name + product heading)', () => {
    const config = seedMerchant({
      displayName: 'Acme',
      legalName: 'Acme Inc.',
      logoUrl: 'https://acme.test/logo.png',
    })
    const ctx = buildCtx(config, [], 0)
    const { container } = renderShell({}, ctx)
    // Host chromes like Cursor only paint the active tool name above
    // the iframe, so the SDK keeps the merchant mark + product h1
    // inside the widget as the reliable identity surface.
    const header = container.querySelector('.solvapay-mcp-shell-header')
    expect(header).not.toBeNull()
    const logo = container.querySelector('.solvapay-mcp-shell-logo') as HTMLImageElement | null
    expect(logo).not.toBeNull()
    expect(logo?.getAttribute('src')).toBe('https://acme.test/logo.png')
    expect(container.querySelector('.solvapay-mcp-shell-brand-name')?.textContent).toBe('Acme')
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1.textContent).toBe('Acme Knowledge Base')
  })

  it('renders the product description as a tagline below the product heading', () => {
    const config = seedMerchant({ displayName: 'Acme', legalName: 'Acme Inc.' })
    const ctx = buildCtx(config, [], 0)
    const { container } = renderShell(
      {
        product: {
          reference: 'prd_x',
          name: 'Acme Knowledge Base',
          description: 'Retrieval-augmented answers for your docs.',
        } as never,
      },
      ctx,
    )
    const tagline = container.querySelector('.solvapay-mcp-shell-tagline')
    expect(tagline?.textContent).toBe('Retrieval-augmented answers for your docs.')
  })

  it('omits the tagline when the product has no description', () => {
    const config = seedMerchant({ displayName: 'Acme', legalName: 'Acme Inc.' })
    const ctx = buildCtx(config, [], 0)
    const { container } = renderShell({}, ctx)
    expect(container.querySelector('.solvapay-mcp-shell-tagline')).toBeNull()
  })

  it('falls back to initials when the merchant has no logoUrl', () => {
    const config = seedMerchant({ displayName: 'Acme Corp', legalName: 'Acme Inc.' })
    const ctx = buildCtx(config, [], 0)
    const { container } = renderShell({}, ctx)
    expect(container.querySelector('.solvapay-mcp-shell-logo')).toBeNull()
    const initials = container.querySelector('.solvapay-mcp-shell-logo-initials')
    expect(initials?.textContent).toBe('AC')
  })

  it('shows the in-iframe header on the paywall so branding + product name stay visible', () => {
    const config = seedMerchant({
      displayName: 'Acme',
      legalName: 'Acme Inc.',
      logoUrl: 'https://acme.test/logo.png',
    })
    const ctx = buildCtx(config, [], 0)
    const { container } = renderShell(
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
    const header = container.querySelector('.solvapay-mcp-shell-header')
    expect(header).not.toBeNull()
    expect(
      container.querySelector('.solvapay-mcp-shell-brand-name')?.textContent,
    ).toBe('Acme')
  })

  it('suppresses the in-iframe header on nudge surfaces (minimal strip)', () => {
    const config = seedMerchant({ displayName: 'Acme', legalName: 'Acme Inc.' })
    const ctx = buildCtx(config, [], 0)
    const { container } = renderShell(
      {
        view: 'nudge',
        nudge: {
          kind: 'low-balance',
          message: 'Low balance',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      },
      ctx,
    )
    expect(container.querySelector('.solvapay-mcp-shell-header')).toBeNull()
  })

  it('paywall view takes over — no sidebar, no footer', () => {
    const config = seedMerchant({
      displayName: 'Acme',
      legalName: 'Acme Inc.',
      termsUrl: 'https://acme.com/terms',
      privacyUrl: 'https://acme.com/privacy',
    })
    const ctx = buildCtx(config, [], 0)
    renderShell(
      {
        view: 'paywall',
        customer: { ref: 'cus_1', purchase: null, paymentMethod: null, balance: null, usage: null },
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
    expect(screen.queryByLabelText('Your account context')).toBeNull()
    expect(screen.queryByText(/Provided by SolvaPay/)).toBeNull()
  })

  it('paywall upgrade CTA flips the body to the checkout surface', () => {
    const config = seedMerchant({ displayName: 'Acme', legalName: 'Acme Inc.' })
    const ctx = buildCtx(config, [], 0)
    renderShell(
      {
        view: 'paywall',
        plans: [
          {
            reference: 'pln_u',
            planType: 'recurring',
            name: 'Unlimited',
            price: 10000,
            currency: 'USD',
            billingCycle: 'monthly',
          } as never,
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

    // After the CTA, the shell body switches to the checkout picker —
    // "Pick your plan" is the heading that `<McpCheckoutView>` renders
    // when no active paid purchase exists.
    expect(screen.getByRole('heading', { name: /Pick your plan|Renew your plan|Upgrade your plan/ })).toBeTruthy()
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

  it('passes `fromPaywall` to the checkout view after the paywall CTA fires', () => {
    const config = seedMerchant({ displayName: 'Acme', legalName: 'Acme Inc.' })
    const ctx = buildCtx(config, [], 0)
    const Checkout = vi.fn(
      (props: { fromPaywall?: boolean }) => (
        <div data-testid="checkout-stub" data-from-paywall={String(props.fromPaywall)} />
      ),
    )
    renderShell(
      {
        view: 'paywall',
        plans: [
          {
            reference: 'pln_u',
            planType: 'recurring',
            name: 'Unlimited',
            price: 10000,
            currency: 'USD',
            billingCycle: 'monthly',
          } as never,
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
      { views: { checkout: Checkout } },
    )

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Upgrade to Unlimited/ }))
    })

    const stub = screen.getByTestId('checkout-stub')
    expect(stub.getAttribute('data-from-paywall')).toBe('true')
  })

  it('change-plan from the account view leaves `fromPaywall` false', () => {
    const config = seedMerchant({ displayName: 'Acme', legalName: 'Acme Inc.' })
    const ctx = buildCtx(config, [], 0)
    const Account = vi.fn((props: { onChangePlan?: () => void }) => (
      <div>
        <button type="button" data-testid="change-plan" onClick={props.onChangePlan}>
          See plans
        </button>
      </div>
    ))
    const Checkout = vi.fn((props: { fromPaywall?: boolean }) => (
      <div data-testid="checkout-stub" data-from-paywall={String(props.fromPaywall)} />
    ))
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
    const stub = screen.getByTestId('checkout-stub')
    expect(stub.getAttribute('data-from-paywall')).toBe('false')
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
