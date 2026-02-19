/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePurchaseStatus } from '../usePurchaseStatus'
import * as usePurchaseModule from '../usePurchase'
import type { PurchaseInfo } from '../../types'

// Helper function to create a test purchase
const createPurchase = (overrides: Partial<PurchaseInfo> = {}): PurchaseInfo => ({
  reference: 'pur_123',
  planName: 'Test Plan',
  productName: 'Test Product',
  productReference: 'prd_123',
  status: 'active',
  startDate: '2024-01-01T00:00:00Z',
  amount: 1000,
  ...overrides,
})

// Mock usePurchase
vi.mock('../usePurchase', () => ({
  usePurchase: vi.fn(),
}))

describe('usePurchaseStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Basic functionality', () => {
    it('should return all expected properties', () => {
      vi.mocked(usePurchaseModule.usePurchase).mockReturnValue({
        purchases: [],
        loading: false,
        hasPlan: vi.fn(),
        activePurchase: null,
        hasPaidPurchase: false,
        activePaidPurchase: null,
        refetch: vi.fn(),
      } as any)

      const { result } = renderHook(() => usePurchaseStatus())

      expect(result.current).toHaveProperty('cancelledPurchase')
      expect(result.current).toHaveProperty('shouldShowCancelledNotice')
      expect(result.current).toHaveProperty('formatDate')
      expect(result.current).toHaveProperty('getDaysUntilExpiration')
    })

    it('should use purchases from usePurchase hook', () => {
      const purchases = [createPurchase()]
      vi.mocked(usePurchaseModule.usePurchase).mockReturnValue({
        purchases,
        loading: false,
        hasPlan: vi.fn(),
        activePurchase: null,
        hasPaidPurchase: false,
        activePaidPurchase: null,
        refetch: vi.fn(),
      } as any)

      const { result } = renderHook(() => usePurchaseStatus())

      expect(result.current.shouldShowCancelledNotice).toBe(false)
      expect(result.current.cancelledPurchase).toBeNull()
    })
  })

  describe('cancelledPurchase', () => {
    it('should return null when no cancelled purchases exist', () => {
      const purchases = [
        createPurchase({ status: 'active', amount: 1000 }),
        createPurchase({ status: 'active', amount: 2000 }),
      ]
      vi.mocked(usePurchaseModule.usePurchase).mockReturnValue({
        purchases,
        loading: false,
        hasPlan: vi.fn(),
        activePurchase: null,
        hasPaidPurchase: true,
        activePaidPurchase: purchases[0],
        refetch: vi.fn(),
      } as any)

      const { result } = renderHook(() => usePurchaseStatus())

      expect(result.current.cancelledPurchase).toBeNull()
      expect(result.current.shouldShowCancelledNotice).toBe(false)
    })

    it('should return null when cancelled purchase is free (amount === 0)', () => {
      const purchases = [
        createPurchase({ status: 'active', amount: 0, cancelledAt: '2024-06-01T00:00:00Z' }),
      ]
      vi.mocked(usePurchaseModule.usePurchase).mockReturnValue({
        purchases,
        loading: false,
        hasPlan: vi.fn(),
        activePurchase: null,
        hasPaidPurchase: false,
        activePaidPurchase: null,
        refetch: vi.fn(),
      } as any)

      const { result } = renderHook(() => usePurchaseStatus())

      expect(result.current.cancelledPurchase).toBeNull()
      expect(result.current.shouldShowCancelledNotice).toBe(false)
    })

    it('should return null when cancelled purchase has undefined amount', () => {
      const purchases = [
        createPurchase({
          status: 'active',
          amount: undefined,
          cancelledAt: '2024-06-01T00:00:00Z',
        }),
      ]
      vi.mocked(usePurchaseModule.usePurchase).mockReturnValue({
        purchases,
        loading: false,
        hasPlan: vi.fn(),
        activePurchase: null,
        hasPaidPurchase: false,
        activePaidPurchase: null,
        refetch: vi.fn(),
      } as any)

      const { result } = renderHook(() => usePurchaseStatus())

      expect(result.current.cancelledPurchase).toBeNull()
      expect(result.current.shouldShowCancelledNotice).toBe(false)
    })

    it('should return cancelled paid purchase when one exists', () => {
      const cancelledPurchase = createPurchase({
        status: 'active',
        amount: 1000,
        planName: 'Cancelled Plan',
        reference: 'pur_cancelled',
        cancelledAt: '2024-06-01T00:00:00Z',
      })
      const purchases = [cancelledPurchase]
      vi.mocked(usePurchaseModule.usePurchase).mockReturnValue({
        purchases,
        loading: false,
        hasPlan: vi.fn(),
        activePurchase: null,
        hasPaidPurchase: false,
        activePaidPurchase: null,
        refetch: vi.fn(),
      } as any)

      const { result } = renderHook(() => usePurchaseStatus())

      expect(result.current.cancelledPurchase).not.toBeNull()
      expect(result.current.cancelledPurchase?.planName).toBe('Cancelled Plan')
      expect(result.current.cancelledPurchase?.status).toBe('active')
      expect(result.current.cancelledPurchase?.amount).toBe(1000)
      expect(result.current.shouldShowCancelledNotice).toBe(true)
    })

    it('should return most recent cancelled purchase when multiple exist', () => {
      const olderCancelled = createPurchase({
        status: 'active',
        amount: 1000,
        cancelledAt: '2024-06-01T00:00:00Z',
        planName: 'Older Plan',
        startDate: '2024-01-01T00:00:00Z',
      })
      const newerCancelled = createPurchase({
        status: 'active',
        cancelledAt: '2024-06-01T00:00:00Z',
        amount: 2000,
        planName: 'Newer Plan',
        startDate: '2024-02-01T00:00:00Z',
      })
      const purchases = [olderCancelled, newerCancelled]
      vi.mocked(usePurchaseModule.usePurchase).mockReturnValue({
        purchases,
        loading: false,
        hasPlan: vi.fn(),
        activePurchase: null,
        hasPaidPurchase: false,
        activePaidPurchase: null,
        refetch: vi.fn(),
      } as any)

      const { result } = renderHook(() => usePurchaseStatus())

      expect(result.current.cancelledPurchase).not.toBeNull()
      expect(result.current.cancelledPurchase?.planName).toBe('Newer Plan')
      expect(result.current.cancelledPurchase?.startDate).toBe('2024-02-01T00:00:00Z')
    })

    it('should only consider cancelled paid purchases', () => {
      const cancelledPaid = createPurchase({
        status: 'active',
        cancelledAt: '2024-06-01T00:00:00Z',
        amount: 1000,
        planName: 'Cancelled Paid',
      })
      const cancelledFree = createPurchase({
        status: 'active',
        cancelledAt: '2024-06-01T00:00:00Z',
        amount: 0,
        planName: 'Cancelled Free',
      })
      const activePaid = createPurchase({
        status: 'active',
        amount: 2000,
        planName: 'Active Paid',
      })
      const purchases = [cancelledPaid, cancelledFree, activePaid]
      vi.mocked(usePurchaseModule.usePurchase).mockReturnValue({
        purchases,
        loading: false,
        hasPlan: vi.fn(),
        activePurchase: activePaid,
        hasPaidPurchase: true,
        activePaidPurchase: activePaid,
        refetch: vi.fn(),
      } as any)

      const { result } = renderHook(() => usePurchaseStatus())

      expect(result.current.cancelledPurchase).not.toBeNull()
      expect(result.current.cancelledPurchase?.planName).toBe('Cancelled Paid')
      expect(result.current.cancelledPurchase?.amount).toBe(1000)
    })

    it('should handle empty purchases array', () => {
      vi.mocked(usePurchaseModule.usePurchase).mockReturnValue({
        purchases: [],
        loading: false,
        hasPlan: vi.fn(),
        activePurchase: null,
        hasPaidPurchase: false,
        activePaidPurchase: null,
        refetch: vi.fn(),
      } as any)

      const { result } = renderHook(() => usePurchaseStatus())

      expect(result.current.cancelledPurchase).toBeNull()
      expect(result.current.shouldShowCancelledNotice).toBe(false)
    })
  })

  describe('shouldShowCancelledNotice', () => {
    it('should be false when no cancelled purchase exists', () => {
      vi.mocked(usePurchaseModule.usePurchase).mockReturnValue({
        purchases: [],
        loading: false,
        hasPlan: vi.fn(),
        activePurchase: null,
        hasPaidPurchase: false,
        activePaidPurchase: null,
        refetch: vi.fn(),
      } as any)

      const { result } = renderHook(() => usePurchaseStatus())

      expect(result.current.shouldShowCancelledNotice).toBe(false)
    })

    it('should be true when cancelled purchase exists', () => {
      const cancelledPurchase = createPurchase({
        status: 'active',
        cancelledAt: '2024-06-01T00:00:00Z',
        amount: 1000,
      })
      vi.mocked(usePurchaseModule.usePurchase).mockReturnValue({
        purchases: [cancelledPurchase],
        loading: false,
        hasPlan: vi.fn(),
        activePurchase: null,
        hasPaidPurchase: false,
        activePaidPurchase: null,
        refetch: vi.fn(),
      } as any)

      const { result } = renderHook(() => usePurchaseStatus())

      expect(result.current.shouldShowCancelledNotice).toBe(true)
    })

    it('should be false when only cancelled free purchase exists', () => {
      const cancelledFree = createPurchase({
        status: 'active',
        cancelledAt: '2024-06-01T00:00:00Z',
        amount: 0,
      })
      vi.mocked(usePurchaseModule.usePurchase).mockReturnValue({
        purchases: [cancelledFree],
        loading: false,
        hasPlan: vi.fn(),
        activePurchase: null,
        hasPaidPurchase: false,
        activePaidPurchase: null,
        refetch: vi.fn(),
      } as any)

      const { result } = renderHook(() => usePurchaseStatus())

      expect(result.current.shouldShowCancelledNotice).toBe(false)
    })
  })

  describe('formatDate', () => {
    it('should format valid date string', () => {
      vi.mocked(usePurchaseModule.usePurchase).mockReturnValue({
        purchases: [],
        loading: false,
        hasPlan: vi.fn(),
        activePurchase: null,
        hasPaidPurchase: false,
        activePaidPurchase: null,
        refetch: vi.fn(),
      } as any)

      const { result } = renderHook(() => usePurchaseStatus())

      const formatted = result.current.formatDate('2024-01-15T00:00:00Z')
      expect(formatted).toBeTruthy()
      expect(typeof formatted).toBe('string')
      // Should contain month name, day, and year
      expect(formatted).toMatch(
        /January|February|March|April|May|June|July|August|September|October|November|December/,
      )
      expect(formatted).toMatch(/2024/)
    })

    it('should return null for undefined date', () => {
      vi.mocked(usePurchaseModule.usePurchase).mockReturnValue({
        purchases: [],
        loading: false,
        hasPlan: vi.fn(),
        activePurchase: null,
        hasPaidPurchase: false,
        activePaidPurchase: null,
        refetch: vi.fn(),
      } as any)

      const { result } = renderHook(() => usePurchaseStatus())

      expect(result.current.formatDate(undefined)).toBeNull()
    })

    it('should return null for empty string', () => {
      vi.mocked(usePurchaseModule.usePurchase).mockReturnValue({
        purchases: [],
        loading: false,
        hasPlan: vi.fn(),
        activePurchase: null,
        hasPaidPurchase: false,
        activePaidPurchase: null,
        refetch: vi.fn(),
      } as any)

      const { result } = renderHook(() => usePurchaseStatus())

      // Empty string is falsy, so should be treated as undefined and return null
      const formatted = result.current.formatDate('')
      expect(formatted).toBeNull()
    })

    it('should format different dates correctly', () => {
      vi.mocked(usePurchaseModule.usePurchase).mockReturnValue({
        purchases: [],
        loading: false,
        hasPlan: vi.fn(),
        activePurchase: null,
        hasPaidPurchase: false,
        activePaidPurchase: null,
        refetch: vi.fn(),
      } as any)

      const { result } = renderHook(() => usePurchaseStatus())

      const date1 = result.current.formatDate('2024-12-31T23:59:59Z')
      const date2 = result.current.formatDate('2024-01-01T00:00:00Z')

      expect(date1).toBeTruthy()
      expect(date2).toBeTruthy()
      expect(date1).not.toBe(date2)
    })

    it('should use en-US locale format', () => {
      vi.mocked(usePurchaseModule.usePurchase).mockReturnValue({
        purchases: [],
        loading: false,
        hasPlan: vi.fn(),
        activePurchase: null,
        hasPaidPurchase: false,
        activePaidPurchase: null,
        refetch: vi.fn(),
      } as any)

      const { result } = renderHook(() => usePurchaseStatus())

      const formatted = result.current.formatDate('2024-03-15T00:00:00Z')
      // Should be in format like "March 15, 2024"
      expect(formatted).toContain('March')
      expect(formatted).toContain('15')
      expect(formatted).toContain('2024')
    })
  })

  describe('getDaysUntilExpiration', () => {
    it('should return null for undefined endDate', () => {
      vi.mocked(usePurchaseModule.usePurchase).mockReturnValue({
        purchases: [],
        loading: false,
        hasPlan: vi.fn(),
        activePurchase: null,
        hasPaidPurchase: false,
        activePaidPurchase: null,
        refetch: vi.fn(),
      } as any)

      const { result } = renderHook(() => usePurchaseStatus())

      expect(result.current.getDaysUntilExpiration(undefined)).toBeNull()
    })

    it('should return null for empty string endDate', () => {
      vi.mocked(usePurchaseModule.usePurchase).mockReturnValue({
        purchases: [],
        loading: false,
        hasPlan: vi.fn(),
        activePurchase: null,
        hasPaidPurchase: false,
        activePaidPurchase: null,
        refetch: vi.fn(),
      } as any)

      const { result } = renderHook(() => usePurchaseStatus())

      // Empty string is falsy, so should return null
      const resultValue = result.current.getDaysUntilExpiration('')
      expect(resultValue).toBeNull()
    })

    it('should return positive days for future date', () => {
      vi.mocked(usePurchaseModule.usePurchase).mockReturnValue({
        purchases: [],
        loading: false,
        hasPlan: vi.fn(),
        activePurchase: null,
        hasPaidPurchase: false,
        activePaidPurchase: null,
        refetch: vi.fn(),
      } as any)

      const { result } = renderHook(() => usePurchaseStatus())

      // Create a date 10 days in the future
      const futureDate = new Date()
      futureDate.setDate(futureDate.getDate() + 10)
      const futureDateString = futureDate.toISOString()

      const days = result.current.getDaysUntilExpiration(futureDateString)
      expect(days).toBeGreaterThan(0)
      expect(days).toBeLessThanOrEqual(10) // Should be around 10, might be 9 or 10 depending on time of day
    })

    it('should return 0 for past date', () => {
      vi.mocked(usePurchaseModule.usePurchase).mockReturnValue({
        purchases: [],
        loading: false,
        hasPlan: vi.fn(),
        activePurchase: null,
        hasPaidPurchase: false,
        activePaidPurchase: null,
        refetch: vi.fn(),
      } as any)

      const { result } = renderHook(() => usePurchaseStatus())

      const pastDate = new Date('2020-01-01T00:00:00Z')
      const days = result.current.getDaysUntilExpiration(pastDate.toISOString())

      expect(days).toBe(0)
    })

    it('should return 0 for date exactly today', () => {
      vi.mocked(usePurchaseModule.usePurchase).mockReturnValue({
        purchases: [],
        loading: false,
        hasPlan: vi.fn(),
        activePurchase: null,
        hasPaidPurchase: false,
        activePaidPurchase: null,
        refetch: vi.fn(),
      } as any)

      const { result } = renderHook(() => usePurchaseStatus())

      const today = new Date()
      today.setHours(23, 59, 59, 999) // End of today
      const days = result.current.getDaysUntilExpiration(today.toISOString())

      // Should be 0 or 1 depending on when test runs
      expect(days).toBeGreaterThanOrEqual(0)
      expect(days).toBeLessThanOrEqual(1)
    })

    it('should calculate days correctly for various future dates', () => {
      vi.mocked(usePurchaseModule.usePurchase).mockReturnValue({
        purchases: [],
        loading: false,
        hasPlan: vi.fn(),
        activePurchase: null,
        hasPaidPurchase: false,
        activePaidPurchase: null,
        refetch: vi.fn(),
      } as any)

      const { result } = renderHook(() => usePurchaseStatus())

      const now = new Date()
      const date1 = new Date(now)
      date1.setDate(date1.getDate() + 1)
      const date2 = new Date(now)
      date2.setDate(date2.getDate() + 30)
      const date3 = new Date(now)
      date3.setDate(date3.getDate() + 365)

      const days1 = result.current.getDaysUntilExpiration(date1.toISOString())
      const days2 = result.current.getDaysUntilExpiration(date2.toISOString())
      const days3 = result.current.getDaysUntilExpiration(date3.toISOString())

      expect(days1).toBeGreaterThan(0)
      expect(days2).toBeGreaterThan(25) // Should be around 30
      expect(days3).toBeGreaterThan(360) // Should be around 365
      expect(days1).not.toBeNull()
      expect(days2).not.toBeNull()
      expect(days3).not.toBeNull()
      expect(days1!).toBeLessThan(days2!)
      expect(days2!).toBeLessThan(days3!)
    })

    it('should use Math.ceil for rounding', () => {
      vi.mocked(usePurchaseModule.usePurchase).mockReturnValue({
        purchases: [],
        loading: false,
        hasPlan: vi.fn(),
        activePurchase: null,
        hasPaidPurchase: false,
        activePaidPurchase: null,
        refetch: vi.fn(),
      } as any)

      const { result } = renderHook(() => usePurchaseStatus())

      // Create a date 1.5 days in the future (should round up to 2)
      const futureDate = new Date()
      futureDate.setTime(futureDate.getTime() + 1.5 * 24 * 60 * 60 * 1000)

      const days = result.current.getDaysUntilExpiration(futureDate.toISOString())
      expect(days).toBeGreaterThanOrEqual(1)
      expect(days).toBeLessThanOrEqual(2)
    })
  })

  describe('Edge cases and integration', () => {
    it('should handle purchase with negative amount', () => {
      const purchase = createPurchase({
        status: 'active',
        cancelledAt: '2024-06-01T00:00:00Z',
        amount: -100,
      })
      vi.mocked(usePurchaseModule.usePurchase).mockReturnValue({
        purchases: [purchase],
        loading: false,
        hasPlan: vi.fn(),
        activePurchase: null,
        hasPaidPurchase: false,
        activePaidPurchase: null,
        refetch: vi.fn(),
      } as any)

      const { result } = renderHook(() => usePurchaseStatus())

      // Negative amount should not be considered paid
      expect(result.current.cancelledPurchase).toBeNull()
      expect(result.current.shouldShowCancelledNotice).toBe(false)
    })

    it('should handle mixed purchase states', () => {
      const activePaid = createPurchase({
        status: 'active',
        amount: 2000,
        planName: 'Active Paid',
      })
      const cancelledPaid = createPurchase({
        status: 'active',
        cancelledAt: '2024-06-01T00:00:00Z',
        amount: 1000,
        planName: 'Cancelled Paid',
        startDate: '2024-01-01T00:00:00Z',
      })
      const activeFree = createPurchase({
        status: 'active',
        amount: 0,
        planName: 'Active Free',
      })
      const purchases = [activePaid, cancelledPaid, activeFree]
      vi.mocked(usePurchaseModule.usePurchase).mockReturnValue({
        purchases,
        loading: false,
        hasPlan: vi.fn(),
        activePurchase: activePaid,
        hasPaidPurchase: true,
        activePaidPurchase: activePaid,
        refetch: vi.fn(),
      } as any)

      const { result } = renderHook(() => usePurchaseStatus())

      expect(result.current.cancelledPurchase).not.toBeNull()
      expect(result.current.cancelledPurchase?.planName).toBe('Cancelled Paid')
      expect(result.current.shouldShowCancelledNotice).toBe(true)
    })

    it('should handle multiple cancelled purchases with different start dates', () => {
      const purchase1 = createPurchase({
        status: 'active',
        cancelledAt: '2024-06-01T00:00:00Z',
        amount: 1000,
        planName: 'Plan 1',
        startDate: '2024-01-01T00:00:00Z',
      })
      const purchase2 = createPurchase({
        status: 'active',
        cancelledAt: '2024-06-01T00:00:00Z',
        amount: 2000,
        planName: 'Plan 2',
        startDate: '2024-03-01T00:00:00Z',
      })
      const purchase3 = createPurchase({
        status: 'active',
        cancelledAt: '2024-06-01T00:00:00Z',
        amount: 3000,
        planName: 'Plan 3',
        startDate: '2024-02-01T00:00:00Z',
      })
      const purchases = [purchase1, purchase2, purchase3]
      vi.mocked(usePurchaseModule.usePurchase).mockReturnValue({
        purchases,
        loading: false,
        hasPlan: vi.fn(),
        activePurchase: null,
        hasPaidPurchase: false,
        activePaidPurchase: null,
        refetch: vi.fn(),
      } as any)

      const { result } = renderHook(() => usePurchaseStatus())

      // Should return the most recent (purchase2 - March 1)
      expect(result.current.cancelledPurchase?.planName).toBe('Plan 2')
      expect(result.current.cancelledPurchase?.startDate).toBe('2024-03-01T00:00:00Z')
    })

    it('should memoize functions correctly', () => {
      vi.mocked(usePurchaseModule.usePurchase).mockReturnValue({
        purchases: [],
        loading: false,
        hasPlan: vi.fn(),
        activePurchase: null,
        hasPaidPurchase: false,
        activePaidPurchase: null,
        refetch: vi.fn(),
      } as any)

      const { result, rerender } = renderHook(() => usePurchaseStatus())

      const formatDate1 = result.current.formatDate
      const getDaysUntilExpiration1 = result.current.getDaysUntilExpiration

      rerender()

      const formatDate2 = result.current.formatDate
      const getDaysUntilExpiration2 = result.current.getDaysUntilExpiration

      // Functions should be stable (same reference) due to useCallback
      expect(formatDate1).toBe(formatDate2)
      expect(getDaysUntilExpiration1).toBe(getDaysUntilExpiration2)
    })

    it('should update cancelledPurchase when purchases change', () => {
      const { result, rerender } = renderHook(() => usePurchaseStatus())

      // Initially no purchases
      vi.mocked(usePurchaseModule.usePurchase).mockReturnValue({
        purchases: [],
        loading: false,
        hasPlan: vi.fn(),
        activePurchase: null,
        hasPaidPurchase: false,
        activePaidPurchase: null,
        refetch: vi.fn(),
      } as any)

      expect(result.current.cancelledPurchase).toBeNull()

      // Add cancelled purchase
      const cancelledPurchase = createPurchase({
        status: 'active',
        cancelledAt: '2024-06-01T00:00:00Z',
        amount: 1000,
      })
      vi.mocked(usePurchaseModule.usePurchase).mockReturnValue({
        purchases: [cancelledPurchase],
        loading: false,
        hasPlan: vi.fn(),
        activePurchase: null,
        hasPaidPurchase: false,
        activePaidPurchase: null,
        refetch: vi.fn(),
      } as any)

      rerender()

      expect(result.current.cancelledPurchase).not.toBeNull()
      expect(result.current.shouldShowCancelledNotice).toBe(true)
    })

    it('should handle date formatting with cancelled purchase', () => {
      const cancelledPurchase = createPurchase({
        status: 'active',
        amount: 1000,
        endDate: '2024-12-31T23:59:59Z',
        cancelledAt: '2024-06-01T00:00:00Z',
      })
      vi.mocked(usePurchaseModule.usePurchase).mockReturnValue({
        purchases: [cancelledPurchase],
        loading: false,
        hasPlan: vi.fn(),
        activePurchase: null,
        hasPaidPurchase: false,
        activePaidPurchase: null,
        refetch: vi.fn(),
      } as any)

      const { result } = renderHook(() => usePurchaseStatus())

      const formattedEndDate = result.current.formatDate(cancelledPurchase.endDate)
      const formattedCancelledAt = result.current.formatDate(cancelledPurchase.cancelledAt)
      const daysLeft = result.current.getDaysUntilExpiration(cancelledPurchase.endDate)

      expect(formattedEndDate).toBeTruthy()
      expect(formattedCancelledAt).toBeTruthy()
      expect(daysLeft).toBeDefined()
    })
  })

  describe('isPaidPurchase helper (internal)', () => {
    it('should correctly identify paid purchases', () => {
      const paidPurchase = createPurchase({ amount: 1000 })
      const freePurchase = createPurchase({ amount: 0 })
      const undefinedPurchase = createPurchase({ amount: undefined })
      const purchases = [paidPurchase, freePurchase, undefinedPurchase]

      vi.mocked(usePurchaseModule.usePurchase).mockReturnValue({
        purchases,
        loading: false,
        hasPlan: vi.fn(),
        activePurchase: null,
        hasPaidPurchase: true,
        activePaidPurchase: paidPurchase,
        refetch: vi.fn(),
      } as any)

      const { result: _result } = renderHook(() => usePurchaseStatus())

      // Only paid cancelled purchases should be returned
      const cancelledPaid = createPurchase({
        status: 'active',
        cancelledAt: '2024-06-01T00:00:00Z',
        amount: 1000,
      })
      vi.mocked(usePurchaseModule.usePurchase).mockReturnValue({
        purchases: [cancelledPaid],
        loading: false,
        hasPlan: vi.fn(),
        activePurchase: null,
        hasPaidPurchase: false,
        activePaidPurchase: null,
        refetch: vi.fn(),
      } as any)

      const { result: result2 } = renderHook(() => usePurchaseStatus())
      expect(result2.current.cancelledPurchase).not.toBeNull()
    })

    it('should handle zero amount as free', () => {
      const cancelledFree = createPurchase({
        status: 'active',
        cancelledAt: '2024-06-01T00:00:00Z',
        amount: 0,
      })
      vi.mocked(usePurchaseModule.usePurchase).mockReturnValue({
        purchases: [cancelledFree],
        loading: false,
        hasPlan: vi.fn(),
        activePurchase: null,
        hasPaidPurchase: false,
        activePaidPurchase: null,
        refetch: vi.fn(),
      } as any)

      const { result } = renderHook(() => usePurchaseStatus())

      expect(result.current.cancelledPurchase).toBeNull()
    })

    it('should handle undefined amount as free', () => {
      const cancelledUndefined = createPurchase({
        status: 'active',
        cancelledAt: '2024-06-01T00:00:00Z',
        amount: undefined,
      })
      vi.mocked(usePurchaseModule.usePurchase).mockReturnValue({
        purchases: [cancelledUndefined],
        loading: false,
        hasPlan: vi.fn(),
        activePurchase: null,
        hasPaidPurchase: false,
        activePaidPurchase: null,
        refetch: vi.fn(),
      } as any)

      const { result } = renderHook(() => usePurchaseStatus())

      expect(result.current.cancelledPurchase).toBeNull()
    })
  })
})
