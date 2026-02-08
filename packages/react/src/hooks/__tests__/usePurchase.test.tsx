import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePurchase } from '../usePurchase'
import * as useSolvaPayModule from '../useSolvaPay'
import type { PurchaseStatus, PurchaseInfo, SolvaPayContextValue } from '../../types'

// Helper function to create a test purchase
const createPurchase = (overrides: Partial<PurchaseInfo> = {}): PurchaseInfo => ({
  reference: 'sub_123',
  planName: 'Test Plan',
  agentName: 'Test Agent',
  status: 'active',
  startDate: '2024-01-01T00:00:00Z',
  amount: 1000,
  ...overrides,
})

// Helper function to create mock purchase status
const createMockPurchaseStatus = (
  overrides: Partial<PurchaseStatus> = {},
): PurchaseStatus => ({
  loading: false,
  purchases: [],
  hasPlan: vi.fn(() => false),
  activePurchase: null,
  hasPaidPurchase: false,
  activePaidPurchase: null,
  ...overrides,
})

// Helper function to create mock context value
const createMockContextValue = (
  purchase: PurchaseStatus,
  refetchPurchase: () => Promise<void> = vi.fn(() => Promise.resolve()),
): SolvaPayContextValue => ({
  purchase,
  refetchPurchase,
  createPayment: vi.fn(),
  customerRef: 'test_customer_ref',
})

// Mock useSolvaPay
vi.mock('../useSolvaPay', () => ({
  useSolvaPay: vi.fn(),
}))

describe('usePurchase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Basic functionality', () => {
    it('should return purchase status from context', () => {
      const mockPurchaseStatus = createMockPurchaseStatus({
        loading: false,
        purchases: [createPurchase()],
      })
      const mockRefetch = vi.fn(() => Promise.resolve())
      const mockContextValue = createMockContextValue(mockPurchaseStatus, mockRefetch)

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue)

      const { result } = renderHook(() => usePurchase())

      expect(result.current.loading).toBe(false)
      expect(result.current.purchases).toHaveLength(1)
      expect(result.current.purchases[0].planName).toBe('Test Plan')
    })

    it('should return refetch function', () => {
      const mockPurchaseStatus = createMockPurchaseStatus()
      const mockRefetch = vi.fn(() => Promise.resolve())
      const mockContextValue = createMockContextValue(mockPurchaseStatus, mockRefetch)

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue)

      const { result } = renderHook(() => usePurchase())

      expect(result.current.refetch).toBeDefined()
      expect(typeof result.current.refetch).toBe('function')
    })

    it('should spread all purchase status properties', () => {
      const mockPurchaseStatus = createMockPurchaseStatus({
        loading: true,
        customerRef: 'customer_123',
        email: 'test@example.com',
        name: 'Test User',
        purchases: [createPurchase()],
      })
      const mockContextValue = createMockContextValue(mockPurchaseStatus)

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue)

      const { result } = renderHook(() => usePurchase())

      expect(result.current.loading).toBe(true)
      expect(result.current.customerRef).toBe('customer_123')
      expect(result.current.email).toBe('test@example.com')
      expect(result.current.name).toBe('Test User')
      expect(result.current.purchases).toHaveLength(1)
    })
  })

  describe('Loading state', () => {
    it('should return loading: true when context indicates loading', () => {
      const mockPurchaseStatus = createMockPurchaseStatus({ loading: true })
      const mockContextValue = createMockContextValue(mockPurchaseStatus)

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue)

      const { result } = renderHook(() => usePurchase())

      expect(result.current.loading).toBe(true)
    })

    it('should return loading: false when context indicates not loading', () => {
      const mockPurchaseStatus = createMockPurchaseStatus({ loading: false })
      const mockContextValue = createMockContextValue(mockPurchaseStatus)

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue)

      const { result } = renderHook(() => usePurchase())

      expect(result.current.loading).toBe(false)
    })
  })

  describe('Purchases array', () => {
    it('should return empty purchases array when no purchases exist', () => {
      const mockPurchaseStatus = createMockPurchaseStatus({ purchases: [] })
      const mockContextValue = createMockContextValue(mockPurchaseStatus)

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue)

      const { result } = renderHook(() => usePurchase())

      expect(result.current.purchases).toEqual([])
      expect(result.current.purchases).toHaveLength(0)
    })

    it('should return single purchase when one purchase exists', () => {
      const purchase = createPurchase({ planName: 'Pro Plan' })
      const mockPurchaseStatus = createMockPurchaseStatus({
        purchases: [purchase],
      })
      const mockContextValue = createMockContextValue(mockPurchaseStatus)

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue)

      const { result } = renderHook(() => usePurchase())

      expect(result.current.purchases).toHaveLength(1)
      expect(result.current.purchases[0].planName).toBe('Pro Plan')
    })

    it('should return multiple purchases when multiple exist', () => {
      const purchases = [
        createPurchase({ planName: 'Plan 1', reference: 'sub_1' }),
        createPurchase({ planName: 'Plan 2', reference: 'sub_2' }),
        createPurchase({ planName: 'Plan 3', reference: 'sub_3' }),
      ]
      const mockPurchaseStatus = createMockPurchaseStatus({ purchases })
      const mockContextValue = createMockContextValue(mockPurchaseStatus)

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue)

      const { result } = renderHook(() => usePurchase())

      expect(result.current.purchases).toHaveLength(3)
      expect(result.current.purchases[0].planName).toBe('Plan 1')
      expect(result.current.purchases[1].planName).toBe('Plan 2')
      expect(result.current.purchases[2].planName).toBe('Plan 3')
    })
  })

  describe('activePurchase', () => {
    it('should return null when no active purchase exists', () => {
      const mockPurchaseStatus = createMockPurchaseStatus({
        activePurchase: null,
      })
      const mockContextValue = createMockContextValue(mockPurchaseStatus)

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue)

      const { result } = renderHook(() => usePurchase())

      expect(result.current.activePurchase).toBeNull()
    })

    it('should return active purchase when one exists', () => {
      const activeSub = createPurchase({ planName: 'Active Plan' })
      const mockPurchaseStatus = createMockPurchaseStatus({
        activePurchase: activeSub,
      })
      const mockContextValue = createMockContextValue(mockPurchaseStatus)

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue)

      const { result } = renderHook(() => usePurchase())

      expect(result.current.activePurchase).not.toBeNull()
      expect(result.current.activePurchase?.planName).toBe('Active Plan')
    })

    it('should return free plan as activePurchase when free plan is active', () => {
      const freeSub = createPurchase({
        planName: 'Free Plan',
        amount: 0,
      })
      const mockPurchaseStatus = createMockPurchaseStatus({
        activePurchase: freeSub,
      })
      const mockContextValue = createMockContextValue(mockPurchaseStatus)

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue)

      const { result } = renderHook(() => usePurchase())

      expect(result.current.activePurchase).not.toBeNull()
      expect(result.current.activePurchase?.planName).toBe('Free Plan')
      expect(result.current.activePurchase?.amount).toBe(0)
    })

    it('should return paid plan as activePurchase when paid plan is active', () => {
      const paidSub = createPurchase({
        planName: 'Paid Plan',
        amount: 2000,
      })
      const mockPurchaseStatus = createMockPurchaseStatus({
        activePurchase: paidSub,
      })
      const mockContextValue = createMockContextValue(mockPurchaseStatus)

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue)

      const { result } = renderHook(() => usePurchase())

      expect(result.current.activePurchase).not.toBeNull()
      expect(result.current.activePurchase?.planName).toBe('Paid Plan')
      expect(result.current.activePurchase?.amount).toBe(2000)
    })
  })

  describe('hasPaidPurchase', () => {
    it('should return false when no paid purchases exist', () => {
      const mockPurchaseStatus = createMockPurchaseStatus({
        hasPaidPurchase: false,
      })
      const mockContextValue = createMockContextValue(mockPurchaseStatus)

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue)

      const { result } = renderHook(() => usePurchase())

      expect(result.current.hasPaidPurchase).toBe(false)
    })

    it('should return true when paid purchase exists', () => {
      const mockPurchaseStatus = createMockPurchaseStatus({
        hasPaidPurchase: true,
      })
      const mockContextValue = createMockContextValue(mockPurchaseStatus)

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue)

      const { result } = renderHook(() => usePurchase())

      expect(result.current.hasPaidPurchase).toBe(true)
    })

    it('should return false when only free purchases exist', () => {
      const freeSub = createPurchase({ amount: 0 })
      const mockPurchaseStatus = createMockPurchaseStatus({
        purchases: [freeSub],
        hasPaidPurchase: false,
        activePurchase: freeSub,
      })
      const mockContextValue = createMockContextValue(mockPurchaseStatus)

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue)

      const { result } = renderHook(() => usePurchase())

      expect(result.current.hasPaidPurchase).toBe(false)
    })
  })

  describe('activePaidPurchase', () => {
    it('should return null when no paid purchase exists', () => {
      const mockPurchaseStatus = createMockPurchaseStatus({
        activePaidPurchase: null,
      })
      const mockContextValue = createMockContextValue(mockPurchaseStatus)

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue)

      const { result } = renderHook(() => usePurchase())

      expect(result.current.activePaidPurchase).toBeNull()
    })

    it('should return paid purchase when one exists', () => {
      const paidSub = createPurchase({
        planName: 'Premium Plan',
        amount: 5000,
      })
      const mockPurchaseStatus = createMockPurchaseStatus({
        activePaidPurchase: paidSub,
      })
      const mockContextValue = createMockContextValue(mockPurchaseStatus)

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue)

      const { result } = renderHook(() => usePurchase())

      expect(result.current.activePaidPurchase).not.toBeNull()
      expect(result.current.activePaidPurchase?.planName).toBe('Premium Plan')
      expect(result.current.activePaidPurchase?.amount).toBe(5000)
    })

    it('should return null when only free purchases exist', () => {
      const freeSub = createPurchase({ amount: 0 })
      const mockPurchaseStatus = createMockPurchaseStatus({
        activePaidPurchase: null,
        activePurchase: freeSub,
      })
      const mockContextValue = createMockContextValue(mockPurchaseStatus)

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue)

      const { result } = renderHook(() => usePurchase())

      expect(result.current.activePaidPurchase).toBeNull()
    })
  })

  describe('hasPlan function', () => {
    it('should return hasPlan function from context', () => {
      const mockHasPlan = vi.fn(() => true)
      const mockPurchaseStatus = createMockPurchaseStatus({
        hasPlan: mockHasPlan,
      })
      const mockContextValue = createMockContextValue(mockPurchaseStatus)

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue)

      const { result } = renderHook(() => usePurchase())

      expect(result.current.hasPlan).toBeDefined()
      expect(typeof result.current.hasPlan).toBe('function')
      expect(result.current.hasPlan('Test Plan')).toBe(true)
      expect(mockHasPlan).toHaveBeenCalledWith('Test Plan')
    })

    it('should return false when hasPlan returns false', () => {
      const mockHasPlan = vi.fn(() => false)
      const mockPurchaseStatus = createMockPurchaseStatus({
        hasPlan: mockHasPlan,
      })
      const mockContextValue = createMockContextValue(mockPurchaseStatus)

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue)

      const { result } = renderHook(() => usePurchase())

      expect(result.current.hasPlan('Non-existent Plan')).toBe(false)
      expect(mockHasPlan).toHaveBeenCalledWith('Non-existent Plan')
    })
  })

  describe('Customer information', () => {
    it('should return customerRef when provided', () => {
      const mockPurchaseStatus = createMockPurchaseStatus({
        customerRef: 'customer_abc123',
      })
      const mockContextValue = createMockContextValue(mockPurchaseStatus)

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue)

      const { result } = renderHook(() => usePurchase())

      expect(result.current.customerRef).toBe('customer_abc123')
    })

    it('should return undefined when customerRef is not provided', () => {
      const mockPurchaseStatus = createMockPurchaseStatus({
        customerRef: undefined,
      })
      const mockContextValue = createMockContextValue(mockPurchaseStatus)

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue)

      const { result } = renderHook(() => usePurchase())

      expect(result.current.customerRef).toBeUndefined()
    })

    it('should return email when provided', () => {
      const mockPurchaseStatus = createMockPurchaseStatus({
        email: 'user@example.com',
      })
      const mockContextValue = createMockContextValue(mockPurchaseStatus)

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue)

      const { result } = renderHook(() => usePurchase())

      expect(result.current.email).toBe('user@example.com')
    })

    it('should return name when provided', () => {
      const mockPurchaseStatus = createMockPurchaseStatus({
        name: 'John Doe',
      })
      const mockContextValue = createMockContextValue(mockPurchaseStatus)

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue)

      const { result } = renderHook(() => usePurchase())

      expect(result.current.name).toBe('John Doe')
    })
  })

  describe('Refetch function', () => {
    it('should call refetchPurchase from context when refetch is called', async () => {
      const mockRefetch = vi.fn(() => Promise.resolve())
      const mockPurchaseStatus = createMockPurchaseStatus()
      const mockContextValue = createMockContextValue(mockPurchaseStatus, mockRefetch)

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue)

      const { result } = renderHook(() => usePurchase())

      await result.current.refetch()

      expect(mockRefetch).toHaveBeenCalledTimes(1)
    })

    it('should return a promise from refetch', async () => {
      const mockRefetch = vi.fn(() => Promise.resolve())
      const mockPurchaseStatus = createMockPurchaseStatus()
      const mockContextValue = createMockContextValue(mockPurchaseStatus, mockRefetch)

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue)

      const { result } = renderHook(() => usePurchase())

      const refetchPromise = result.current.refetch()
      expect(refetchPromise).toBeInstanceOf(Promise)

      await refetchPromise
      expect(mockRefetch).toHaveBeenCalled()
    })

    it('should handle refetch errors gracefully', async () => {
      const mockRefetch = vi.fn(() => Promise.reject(new Error('Refetch failed')))
      const mockPurchaseStatus = createMockPurchaseStatus()
      const mockContextValue = createMockContextValue(mockPurchaseStatus, mockRefetch)

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue)

      const { result } = renderHook(() => usePurchase())

      await expect(result.current.refetch()).rejects.toThrow('Refetch failed')
      expect(mockRefetch).toHaveBeenCalledTimes(1)
    })
  })

  describe('Complex scenarios', () => {
    it('should handle multiple paid purchases correctly', () => {
      const paidSub1 = createPurchase({
        planName: 'Premium',
        amount: 5000,
        reference: 'sub_premium',
        startDate: '2024-01-01T00:00:00Z',
      })
      const paidSub2 = createPurchase({
        planName: 'Pro',
        amount: 3000,
        reference: 'sub_pro',
        startDate: '2024-02-01T00:00:00Z',
      })
      const mockPurchaseStatus = createMockPurchaseStatus({
        purchases: [paidSub1, paidSub2],
        hasPaidPurchase: true,
        activePaidPurchase: paidSub2, // Most recent
        activePurchase: paidSub2,
      })
      const mockContextValue = createMockContextValue(mockPurchaseStatus)

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue)

      const { result } = renderHook(() => usePurchase())

      expect(result.current.hasPaidPurchase).toBe(true)
      expect(result.current.activePaidPurchase?.planName).toBe('Pro')
      expect(result.current.activePurchase?.planName).toBe('Pro')
      expect(result.current.purchases).toHaveLength(2)
    })

    it('should handle mixed paid and free purchases', () => {
      const freeSub = createPurchase({
        planName: 'Free',
        amount: 0,
        reference: 'sub_free',
      })
      const paidSub = createPurchase({
        planName: 'Paid',
        amount: 1000,
        reference: 'sub_paid',
      })
      const mockPurchaseStatus = createMockPurchaseStatus({
        purchases: [freeSub, paidSub],
        hasPaidPurchase: true,
        activePaidPurchase: paidSub,
        activePurchase: paidSub, // Paid is primary
      })
      const mockContextValue = createMockContextValue(mockPurchaseStatus)

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue)

      const { result } = renderHook(() => usePurchase())

      expect(result.current.hasPaidPurchase).toBe(true)
      expect(result.current.activePaidPurchase?.planName).toBe('Paid')
      expect(result.current.activePurchase?.planName).toBe('Paid')
    })

    it('should handle cancelled purchase with endDate - should still grant access until expiration', () => {
      const cancelledSub = createPurchase({
        planName: 'Cancelled Plan',
        status: 'active', // Backend keeps status as 'active' until expiration
        amount: 2000,
        endDate: '2025-12-31T23:59:59Z',
        cancelledAt: '2024-06-01T00:00:00Z',
      })
      const mockPurchaseStatus = createMockPurchaseStatus({
        purchases: [cancelledSub],
        activePurchase: cancelledSub, // Still active until endDate
        hasPaidPurchase: true, // Status is active, so still grants access
        activePaidPurchase: cancelledSub, // Status is active, so still grants access
      })
      const mockContextValue = createMockContextValue(mockPurchaseStatus)

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue)

      const { result } = renderHook(() => usePurchase())

      expect(result.current.activePurchase?.planName).toBe('Cancelled Plan')
      expect(result.current.activePurchase?.status).toBe('active')
      expect(result.current.hasPaidPurchase).toBe(true) // Should still grant access
      expect(result.current.activePaidPurchase?.planName).toBe('Cancelled Plan')
    })

    it('should handle empty state with no purchases', () => {
      const mockPurchaseStatus = createMockPurchaseStatus({
        purchases: [],
        activePurchase: null,
        hasPaidPurchase: false,
        activePaidPurchase: null,
        customerRef: undefined,
        email: undefined,
        name: undefined,
      })
      const mockContextValue = createMockContextValue(mockPurchaseStatus)

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue)

      const { result } = renderHook(() => usePurchase())

      expect(result.current.purchases).toEqual([])
      expect(result.current.activePurchase).toBeNull()
      expect(result.current.hasPaidPurchase).toBe(false)
      expect(result.current.activePaidPurchase).toBeNull()
    })
  })

  describe('Purchase properties', () => {
    it('should return all purchase properties correctly', () => {
      const purchase = createPurchase({
        reference: 'sub_full',
        planName: 'Full Plan',
        agentName: 'Full Agent',
        status: 'active',
        startDate: '2024-01-01T00:00:00Z',
        endDate: '2024-12-31T23:59:59Z',
        cancelledAt: undefined,
        cancellationReason: undefined,
        amount: 1500,
      })
      const mockPurchaseStatus = createMockPurchaseStatus({
        purchases: [purchase],
        activePurchase: purchase,
      })
      const mockContextValue = createMockContextValue(mockPurchaseStatus)

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue)

      const { result } = renderHook(() => usePurchase())

      const returnedPurchase = result.current.purchases[0]
      expect(returnedPurchase.reference).toBe('sub_full')
      expect(returnedPurchase.planName).toBe('Full Plan')
      expect(returnedPurchase.agentName).toBe('Full Agent')
      expect(returnedPurchase.status).toBe('active')
      expect(returnedPurchase.startDate).toBe('2024-01-01T00:00:00Z')
      expect(returnedPurchase.endDate).toBe('2024-12-31T23:59:59Z')
      expect(returnedPurchase.amount).toBe(1500)
    })

    it('should handle purchase with cancellation reason', () => {
      const purchase = createPurchase({
        status: 'active', // Backend keeps status as 'active' until expiration
        cancelledAt: '2024-06-01T00:00:00Z',
        cancellationReason: 'Customer request',
      })
      const mockPurchaseStatus = createMockPurchaseStatus({
        purchases: [purchase],
        activePurchase: purchase,
      })
      const mockContextValue = createMockContextValue(mockPurchaseStatus)

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue)

      const { result } = renderHook(() => usePurchase())

      const returnedPurchase = result.current.purchases[0]
      expect(returnedPurchase.status).toBe('active')
      expect(returnedPurchase.cancelledAt).toBe('2024-06-01T00:00:00Z')
      expect(returnedPurchase.cancellationReason).toBe('Customer request')
    })
  })

  describe('Edge cases', () => {
    it('should handle undefined amount (treated as free)', () => {
      const purchase = createPurchase({
        amount: undefined,
      })
      const mockPurchaseStatus = createMockPurchaseStatus({
        purchases: [purchase],
        activePurchase: purchase,
        hasPaidPurchase: false,
      })
      const mockContextValue = createMockContextValue(mockPurchaseStatus)

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue)

      const { result } = renderHook(() => usePurchase())

      expect(result.current.purchases[0].amount).toBeUndefined()
      expect(result.current.hasPaidPurchase).toBe(false)
    })

    it('should handle zero amount (treated as free)', () => {
      const purchase = createPurchase({
        amount: 0,
      })
      const mockPurchaseStatus = createMockPurchaseStatus({
        purchases: [purchase],
        activePurchase: purchase,
        hasPaidPurchase: false,
      })
      const mockContextValue = createMockContextValue(mockPurchaseStatus)

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue)

      const { result } = renderHook(() => usePurchase())

      expect(result.current.purchases[0].amount).toBe(0)
      expect(result.current.hasPaidPurchase).toBe(false)
    })

    it('should handle very large purchase amounts', () => {
      const purchase = createPurchase({
        amount: 999999999,
      })
      const mockPurchaseStatus = createMockPurchaseStatus({
        purchases: [purchase],
        activePurchase: purchase,
        hasPaidPurchase: true,
        activePaidPurchase: purchase,
      })
      const mockContextValue = createMockContextValue(mockPurchaseStatus)

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue)

      const { result } = renderHook(() => usePurchase())

      expect(result.current.purchases[0].amount).toBe(999999999)
      expect(result.current.hasPaidPurchase).toBe(true)
    })

    it('should handle negative amount (edge case)', () => {
      const purchase = createPurchase({
        amount: -100,
      })
      const mockPurchaseStatus = createMockPurchaseStatus({
        purchases: [purchase],
        activePurchase: purchase,
        hasPaidPurchase: false, // Negative is not considered paid
      })
      const mockContextValue = createMockContextValue(mockPurchaseStatus)

      vi.mocked(useSolvaPayModule.useSolvaPay).mockReturnValue(mockContextValue)

      const { result } = renderHook(() => usePurchase())

      expect(result.current.purchases[0].amount).toBe(-100)
      expect(result.current.hasPaidPurchase).toBe(false)
    })
  })
})
