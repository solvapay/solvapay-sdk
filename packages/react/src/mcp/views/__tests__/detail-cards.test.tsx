import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { McpCustomerDetailsCard, McpSellerDetailsCard } from '../detail-cards'
import { SolvaPayContext } from '../../../SolvaPayProvider'
import { merchantCache } from '../../../hooks/useMerchant'
import { createTransportCacheKey } from '../../../transport/cache-key'
import type {
  SolvaPayContextValue,
  SolvaPayConfig,
  PurchaseInfo,
  Merchant,
} from '../../../types'

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
    createCustomerSession: vi.fn(),
    getMerchant: vi.fn(),
    getProduct: vi.fn(),
    listPlans: vi.fn(),
    getPaymentMethod: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
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
    _config: config ?? { transport: makeTransport() },
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
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
    expect(screen.queryByText(/Credit balance/i)).toBeNull()
  })

  it('renders the balance row and formatted credits when credits > 0', () => {
    const ctx = buildCtx({}, [], 1500)
    renderWith(ctx, <McpCustomerDetailsCard />)
    expect(screen.getByText(/Credit balance/i)).toBeTruthy()
    expect(screen.getByText(/1,500 credits/)).toBeTruthy()
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
})
