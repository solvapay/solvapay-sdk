import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { McpCustomerDetailsCard, McpSellerDetailsCard } from '../detail-cards'
import { SolvaPayContext } from '../../../SolvaPayProvider'
import { merchantCache } from '../../../hooks/useMerchant'
import { createTransportCacheKey } from '../../../transport/cache-key'
import type { SolvaPayContextValue, SolvaPayConfig, PurchaseInfo, Merchant } from '../../../types'
import type { SolvaPayTransport } from '../../../transport/types'
import { mockBalanceStatus } from '../../../test-helpers/mockBalanceStatus'

function makeTransport(): SolvaPayTransport {
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
    createCustomerSession: vi.fn(),
    getMerchant: vi.fn(),
    getProduct: vi.fn(),
    listPlans: vi.fn(),
    getPaymentMethod: vi.fn(),
  }
}

function seedMerchant(merchant: Merchant | null): SolvaPayConfig {
  const config: SolvaPayConfig = { transport: makeTransport() }
  // Mirror `seedMcpCaches` so the cache key matches what `useMerchant`
  // computes on first render.
  const key = createTransportCacheKey(config, '/api/merchant')
  merchantCache.set(key, {
    merchant,
    promise: null,
    timestamp: Date.now(),
  })
  return config
}

function buildCtx(
  overrides: Partial<SolvaPayContextValue> = {},
  purchases: PurchaseInfo[] = [],
  credits: number | null = null,
  config?: SolvaPayConfig,
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
      name: 'Demo User',
    },
    refetchPurchase: vi.fn(),
    upsertPurchase: vi.fn(),
    createPayment: vi.fn(),
    createTopupPayment: vi.fn(),
    cancelRenewal: vi.fn(),
    reactivateRenewal: vi.fn(),
    activatePlan: vi.fn(),
    balance: mockBalanceStatus({
      credits,
      displayCurrency: 'USD',
      creditsPerMinorUnit: 100,
      displayExchangeRate: 1,
    }),
    _config: config ?? { transport: makeTransport() },
    ...overrides,
  }
}

function renderWith(ctx: SolvaPayContextValue, node: React.ReactNode) {
  return render(<SolvaPayContext.Provider value={ctx}>{node}</SolvaPayContext.Provider>)
}

describe('<McpCustomerDetailsCard>', () => {
  beforeEach(() => {
    merchantCache.clear()
  })

  it('renders name, email, and monospaced customer reference', () => {
    const ctx = buildCtx({}, [], 0)
    renderWith(ctx, <McpCustomerDetailsCard />)
    expect(screen.getByText('Demo User')).toBeTruthy()
    expect(screen.getByText('demo@acme.test')).toBeTruthy()
    expect(screen.getByText('cus_abc')).toBeTruthy()
  })

  it('omits the balance row when credits are zero', () => {
    const ctx = buildCtx({}, [], 0)
    renderWith(ctx, <McpCustomerDetailsCard />)
    expect(screen.queryByText(/credits/i)).toBeNull()
  })

  it('renders formatted credits without a Credit balance label when credits > 0', () => {
    const ctx = buildCtx({}, [], 1500)
    renderWith(ctx, <McpCustomerDetailsCard />)
    expect(screen.queryByText(/Credit balance/i)).toBeNull()
    expect(screen.getByText(/1,500 credits/)).toBeTruthy()
    expect(screen.getByText(/~\$0\.15/)).toBeTruthy()
  })

  it('shows ~SEK 150.92 for 159,600 credits (not 100x inflated)', () => {
    const ctx = buildCtx(
      {
        balance: mockBalanceStatus({
          credits: 159_600,
          displayCurrency: 'SEK',
          creditsPerMinorUnit: 100,
          displayExchangeRate: 9.46,
        }),
      },
      [],
      159_600,
    )
    renderWith(ctx, <McpCustomerDetailsCard />)
    expect(screen.getByText(/159,600 credits/)).toBeTruthy()
    expect(screen.getByText(/~kr150\.98|~SEK 150\.98/)).toBeTruthy()
    expect(screen.queryByText(/15,103/)).toBeNull()
  })

  it('shows Top up link and calls onTopup when clicked', () => {
    const ctx = buildCtx({}, [], 1000)
    const onTopup = vi.fn()
    renderWith(ctx, <McpCustomerDetailsCard onTopup={onTopup} />)
    const btn = screen.getByRole('button', { name: /top up/i })
    fireEvent.click(btn)
    expect(onTopup).toHaveBeenCalledOnce()
  })

  it('hides balance when hideBalance is set (unlimited plan case)', () => {
    const ctx = buildCtx({}, [], 1000)
    renderWith(ctx, <McpCustomerDetailsCard hideBalance />)
    expect(screen.queryByText(/Credit balance/i)).toBeNull()
  })
})

describe('<McpSellerDetailsCard>', () => {
  beforeEach(() => {
    merchantCache.clear()
  })

  it('renders the merchant displayName, legal name, and verified badge', () => {
    const merchant: Merchant = {
      displayName: 'Acme',
      legalName: 'Acme Inc.',
      supportEmail: 'support@acme.com',
      supportUrl: 'https://acme.com/support',
      country: 'US',
    }
    const config = seedMerchant(merchant)
    const ctx = buildCtx({}, [], 0, config)
    renderWith(ctx, <McpSellerDetailsCard />)
    expect(screen.getByText('Acme')).toBeTruthy()
    expect(screen.getByText('Acme Inc.')).toBeTruthy()
    expect(screen.getByText('support@acme.com')).toBeTruthy()
    expect(screen.getByLabelText('Verified seller')).toBeTruthy()
  })

  it('omits the verified badge when showVerifiedBadge={false}', () => {
    const merchant: Merchant = { displayName: 'Acme', legalName: 'Acme Inc.' }
    const config = seedMerchant(merchant)
    const ctx = buildCtx({}, [], 0, config)
    renderWith(ctx, <McpSellerDetailsCard showVerifiedBadge={false} />)
    expect(screen.queryByLabelText('Verified seller')).toBeNull()
  })

  it('collapses legalName row when it matches displayName', () => {
    const merchant: Merchant = { displayName: 'Acme Inc.', legalName: 'Acme Inc.' }
    const config = seedMerchant(merchant)
    const ctx = buildCtx({}, [], 0, config)
    renderWith(ctx, <McpSellerDetailsCard />)
    // Only one occurrence of 'Acme Inc.' (the primary displayName row).
    expect(screen.getAllByText('Acme Inc.')).toHaveLength(1)
  })

  it('renders a VAT number row and a company number line for a VAT-required merchant', () => {
    const merchant: Merchant = {
      displayName: 'Acme GmbH',
      legalName: 'Acme GmbH',
      country: 'DE',
      vatNumber: 'DE123456789',
      companyNumber: 'HRB12345',
    }
    const config = seedMerchant(merchant)
    const ctx = buildCtx({}, [], 0, config)
    renderWith(ctx, <McpSellerDetailsCard />)
    expect(screen.getByText('VAT number')).toBeTruthy()
    expect(screen.getByText('DE123456789')).toBeTruthy()
    expect(screen.getByText('Company number')).toBeTruthy()
    expect(screen.getByText('HRB12345')).toBeTruthy()
  })

  it('renders the core EIN label and no duplicate company line for a US merchant', () => {
    const merchant: Merchant = {
      displayName: 'Acme Inc.',
      legalName: 'Acme Inc.',
      country: 'US',
      taxId: '12-3456789',
    }
    const config = seedMerchant(merchant)
    const ctx = buildCtx({}, [], 0, config)
    renderWith(ctx, <McpSellerDetailsCard />)
    expect(screen.getByText('EIN (Employer Identification Number)')).toBeTruthy()
    // The tax id doubles as the org number, so it appears exactly once and the
    // company-number line is suppressed.
    expect(screen.getAllByText('12-3456789')).toHaveLength(1)
    expect(screen.queryByText('Company number')).toBeNull()
  })

  it('renders neither the tax nor company row when no identifiers are present', () => {
    const merchant: Merchant = { displayName: 'Acme', legalName: 'Acme Inc.', country: 'US' }
    const config = seedMerchant(merchant)
    const ctx = buildCtx({}, [], 0, config)
    renderWith(ctx, <McpSellerDetailsCard />)
    expect(screen.queryByText('Company number')).toBeNull()
    expect(screen.queryByText('VAT number')).toBeNull()
    expect(screen.queryByText('EIN (Employer Identification Number)')).toBeNull()
  })
})
