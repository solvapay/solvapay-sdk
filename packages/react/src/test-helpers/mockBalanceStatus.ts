import { vi } from 'vitest'
import type { BalanceStatus } from '../types'

/** Typed balance stub for tests — satisfies {@link BalanceStatus} including newer fields. */
export function mockBalanceStatus(overrides: Partial<BalanceStatus> = {}): BalanceStatus {
  const { display, ...rest } = overrides
  return {
    loading: false,
    credits: null,
    displayCurrency: null,
    creditsPerMinorUnit: null,
    displayExchangeRate: null,
    refetch: vi.fn(),
    adjustBalance: vi.fn(),
    reconcileAfterUsageDebit: vi.fn(),
    ...rest,
    display: display ?? null,
  }
}
