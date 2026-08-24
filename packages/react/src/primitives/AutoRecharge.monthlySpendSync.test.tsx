/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { BALANCE_RECONCILE_DELAYS_MS } from '@solvapay/server'
import { AutoRecharge } from './AutoRecharge'
import { SolvaPayProvider } from '../SolvaPayProvider'
import { useSolvaPay } from '../hooks/useSolvaPay'
import { autoRechargeCache } from '../hooks/autoRechargeCache'

const mockAdapter = {
  getToken: vi.fn().mockResolvedValue('test-token'),
  getUserId: vi.fn().mockResolvedValue('user-123'),
}

function BalanceReconciler() {
  const { balance } = useSolvaPay()
  return (
    <button
      type="button"
      onClick={() => {
        balance.adjustBalance(-600)
        balance.reconcileAfterUsageDebit({ expectIncrease: true })
      }}
    >
      Simulate usage debit
    </button>
  )
}

describe('AutoRecharge MonthlySpend sync', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'))
    localStorage.clear()
    autoRechargeCache.clear()

    let balanceFetchCount = 0
    let autoRechargeFetchCount = 0

    fetchSpy = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('customer-balance')) {
        balanceFetchCount += 1
        if (balanceFetchCount === 1) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ credits: 10_000, displayCurrency: 'USD' }),
          })
        }
        if (balanceFetchCount <= 4) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ credits: 9400, displayCurrency: 'USD' }),
          })
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ credits: 19_400, displayCurrency: 'USD' }),
        })
      }
      if (typeof url === 'string' && url.includes('auto-recharge')) {
        autoRechargeFetchCount += 1
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              config: {
                enabled: true,
                trigger: { type: 'balance', thresholdAmountMinor: 500 },
                topup: { mode: 'fixed', amountMinor: 1000, currency: 'USD' },
                status: 'active',
                failureCount: 0,
                maxMonthlySpendMinor: 10_000,
                monthlySpendMinor: autoRechargeFetchCount === 1 ? 4500 : 5500,
                monthlySpendPeriod: '2026-07',
              },
            }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ customerRef: 'cus_auto', purchases: [] }),
      })
    })
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    autoRechargeCache.clear()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('updates MonthlySpend in place after reconcile-driven cache invalidation', async () => {
    render(
      <SolvaPayProvider config={{ auth: { adapter: mockAdapter } }}>
        <BalanceReconciler />
        <AutoRecharge.Root currency="USD">
          <AutoRecharge.MonthlySpend />
        </AutoRecharge.Root>
      </SolvaPayProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('$45 / $100 this month')).toBeInTheDocument()
    })

    await act(async () => {
      screen.getByRole('button', { name: 'Simulate usage debit' }).click()
    })

    await act(async () => {
      for (const delay of BALANCE_RECONCILE_DELAYS_MS) {
        await vi.advanceTimersByTimeAsync(delay)
      }
    })

    await waitFor(() => {
      expect(screen.getByText('$55 / $100 this month')).toBeInTheDocument()
    })
    expect(screen.queryByText('$45 / $100 this month')).not.toBeInTheDocument()
  })
})
