import { render, screen } from '@testing-library/react'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { SolvaPayProvider } from '../SolvaPayProvider'
import { usePurchase } from '../hooks/usePurchase'
import { useUsage } from '../hooks/useUsage'
import { CurrentPlanCard } from '../components/CurrentPlanCard'
import { paymentMethodCache } from '../hooks/usePaymentMethod'

const mockAdapter = {
  getToken: vi.fn().mockResolvedValue('test-token'),
  getUserId: vi.fn().mockResolvedValue('user-123'),
}

const PAYG_ACTIVATION_RESPONSE = {
  customerRef: 'cus_test',
  purchases: [
    {
      reference: 'pur_payg',
      customerRef: 'cus_test',
      productName: 'Widget API',
      productRef: 'prd_api',
      status: 'active',
      startDate: '2026-01-01',
      createdAt: '2026-01-01',
      amount: 0,
      currency: 'USD',
      isRecurring: false,
      planRef: 'plan_payg',
      planSnapshot: {
        reference: 'plan_payg',
        name: 'Pay as you go',
        currency: 'USD',
        price: 0,
        isMetered: true,
      },
      usage: { used: 0 },
    },
  ],
}

/**
 * Credits buy a finite number of metered items, so the allowance endpoint
 * answers with a real count — never the `-1` unlimited sentinel. This is
 * what keeps the card off the "Unlimited" label (DEV-545).
 */
const PAYG_LIMITS_RESPONSE = {
  remaining: 25,
  withinLimits: true,
  meterName: 'requests',
  activationRequired: false,
}

function respond(url: string) {
  const json =
    typeof url === 'string' && url.includes('payment-method')
      ? { kind: 'none' }
      : typeof url === 'string' && url.includes('/api/limits')
        ? PAYG_LIMITS_RESPONSE
        : PAYG_ACTIVATION_RESPONSE
  return Promise.resolve({ ok: true, json: () => Promise.resolve(json) })
}

function createWrapper(props?: Record<string, unknown>) {
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(
      SolvaPayProvider,
      {
        config: {
          auth: { adapter: mockAdapter },
        },
        ...props,
        children,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    )
  Wrapper.displayName = 'PaygActivationTestWrapper'
  return Wrapper
}

describe('PAYG activation parity (zero-amount active purchase)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    localStorage.clear()
    paymentMethodCache.clear()

    fetchSpy = vi.fn().mockImplementation((url: string) => respond(url))
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    paymentMethodCache.clear()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('derives activePurchase from checkPurchase response via SolvaPayProvider', async () => {
    const { result } = renderHook(() => usePurchase(), { wrapper: createWrapper() })

    await waitFor(() => {
      expect(result.current.activePurchase?.reference).toBe('pur_payg')
    })

    expect(result.current.hasPaidPurchase).toBe(false)
    expect(result.current.activePurchase?.amount).toBe(0)
  })

  it('derives credit-based usage with isUnlimited false via useUsage', async () => {
    const { result } = renderHook(
      () => ({
        purchase: usePurchase(),
        usage: useUsage(),
      }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(result.current.purchase.activePurchase?.reference).toBe('pur_payg')
    })

    expect(result.current.usage.usage).not.toBeNull()
    expect(result.current.usage.isUnlimited).toBe(false)
  })

  it('renders CurrentPlanCard with PAYG plan name when active purchase is zero-amount', async () => {
    render(
      React.createElement(
        SolvaPayProvider,
        {
          config: { auth: { adapter: mockAdapter } },
          children: React.createElement(CurrentPlanCard),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      ),
    )

    await waitFor(() => {
      expect(screen.getByText('Pay as you go')).toBeTruthy()
    })
    expect(screen.queryByText('Unlimited')).toBeNull()
    expect(
      document.querySelector('[data-solvapay-current-plan-balance-line]'),
    ).toBeTruthy()
  })
})

/**
 * Parity with solvapay-frontend manage account (DEV-545):
 * - CustomerManagePage: zero-amount PAYG active purchase → PurchaseCard, no Activate
 * - PlanAndPurchasesSection: credit balance shown, not "Unlimited usage"
 */
describe('manage account parity (DEV-545)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    localStorage.clear()
    paymentMethodCache.clear()

    fetchSpy = vi.fn().mockImplementation((url: string) => respond(url))
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    paymentMethodCache.clear()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function createWrapper() {
    const Wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        SolvaPayProvider,
        {
          config: { auth: { adapter: mockAdapter } },
          children,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      )
    Wrapper.displayName = 'ManageAccountParityWrapper'
    return Wrapper
  }

  it('treats zero-amount PAYG activation as active plan state, not empty or paid', async () => {
    const { result } = renderHook(
      () => ({
        purchase: usePurchase(),
        usage: useUsage(),
      }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(result.current.purchase.activePurchase?.reference).toBe('pur_payg')
    })

    // Manage: PurchaseCard with active purchase; SDK: activePurchase populated
    expect(result.current.purchase.activePurchase?.planSnapshot?.isMetered).toBe(true)
    expect(result.current.purchase.activePurchase?.amount).toBe(0)
    expect(result.current.purchase.hasPaidPurchase).toBe(false)
    expect(result.current.purchase.activePaidPurchase).toBeNull()

    // Manage: credit balance / units, not "Unlimited usage"
    expect(result.current.usage.isUnlimited).toBe(false)
    expect(result.current.usage.usage).not.toBeNull()
  })

  it('renders CurrentPlanCard (manage PurchaseCard equivalent) instead of activation-empty UI', async () => {
    render(
      React.createElement(
        SolvaPayProvider,
        {
          config: { auth: { adapter: mockAdapter } },
          children: React.createElement(CurrentPlanCard),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      ),
    )

    await waitFor(() => {
      expect(document.querySelector('[data-solvapay-current-plan-card]')).toBeTruthy()
    })

    expect(screen.getByText('Pay as you go')).toBeTruthy()
    expect(screen.queryByText('Unlimited')).toBeNull()
    expect(screen.queryByText('No active plan')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Activate' })).toBeNull()
  })
})
