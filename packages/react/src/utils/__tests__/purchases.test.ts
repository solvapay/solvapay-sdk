import { describe, it, expect } from 'vitest'
import {
  isPaidPurchase,
  filterPurchases,
  getActivePurchases,
  getCancelledPurchasesWithEndDate,
} from '../purchases'
import type { PurchaseInfo } from '../../types'

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

describe('filterPurchases', () => {
  it('should filter to only include active purchases', () => {
    const purchases = [
      createPurchase({ status: 'active', planName: 'Active Plan' }),
      createPurchase({ status: 'cancelled', planName: 'Cancelled Plan' }),
      createPurchase({ status: 'expired', planName: 'Expired Plan' }),
      createPurchase({ status: 'active', planName: 'Another Active' }),
    ]

    const filtered = filterPurchases(purchases)

    expect(filtered).toHaveLength(2)
    expect(filtered.every(purchase => purchase.status === 'active')).toBe(true)
    expect(filtered.some(purchase => purchase.planName === 'Active Plan')).toBe(true)
    expect(filtered.some(purchase => purchase.planName === 'Another Active')).toBe(true)
  })

  it('should include cancelled purchases with status active', () => {
    const purchases = [
      createPurchase({
        status: 'active',
        planName: 'Cancelled but Active',
        cancelledAt: '2024-06-01T00:00:00Z',
      }),
    ]

    const filtered = filterPurchases(purchases)

    expect(filtered).toHaveLength(1)
    expect(filtered[0].status).toBe('active')
  })
})

describe('getActivePurchases', () => {
  it('should return only purchases with status active', () => {
    const purchases = [
      createPurchase({ status: 'active', planName: 'Active 1' }),
      createPurchase({ status: 'active', planName: 'Active 2' }),
      createPurchase({ status: 'cancelled', planName: 'Cancelled' }),
    ]

    const active = getActivePurchases(purchases)

    expect(active).toHaveLength(2)
    expect(active.every(purchase => purchase.status === 'active')).toBe(true)
  })
})

describe('getCancelledPurchasesWithEndDate', () => {
  it('should return cancelled purchases with status active and future endDate', () => {
    const futureDate = new Date()
    futureDate.setFullYear(futureDate.getFullYear() + 1)

    const purchases = [
      createPurchase({
        status: 'active',
        cancelledAt: '2024-06-01T00:00:00Z',
        endDate: futureDate.toISOString(),
        planName: 'Cancelled Active',
      }),
      createPurchase({
        status: 'active',
        cancelledAt: undefined,
        planName: 'Not Cancelled',
      }),
      createPurchase({
        status: 'active',
        cancelledAt: '2024-06-01T00:00:00Z',
        endDate: '2024-01-01T00:00:00Z', // Past date
        planName: 'Expired Cancelled',
      }),
    ]

    const cancelled = getCancelledPurchasesWithEndDate(purchases)

    expect(cancelled).toHaveLength(1)
    expect(cancelled[0].planName).toBe('Cancelled Active')
  })
})

describe('isPaidPurchase', () => {
  it('should return true for purchase with amount > 0', () => {
    const purchase = createPurchase({ amount: 1000 })
    expect(isPaidPurchase(purchase)).toBe(true)
  })

  it('should return false for purchase with amount === 0', () => {
    const purchase = createPurchase({ amount: 0 })
    expect(isPaidPurchase(purchase)).toBe(false)
  })

  it('should return false for purchase with undefined amount', () => {
    const purchase = createPurchase({ amount: undefined })
    expect(isPaidPurchase(purchase)).toBe(false)
  })
})

describe('Integration: status active + isPaidPurchase', () => {
  it('should correctly identify cancelled paid purchase with status active as granting access', () => {
    const futureDate = new Date()
    futureDate.setFullYear(futureDate.getFullYear() + 1)
    const purchase = createPurchase({
      status: 'active',
      amount: 2000,
      cancelledAt: '2024-06-01T00:00:00Z',
      endDate: futureDate.toISOString(),
    })

    expect(purchase.status === 'active').toBe(true)
    expect(isPaidPurchase(purchase)).toBe(true)
    // This combination should grant access
    expect(purchase.status === 'active' && isPaidPurchase(purchase)).toBe(true)
  })

  it('should correctly identify expired purchase as not granting access', () => {
    const purchase = createPurchase({
      status: 'expired',
      amount: 2000,
      cancelledAt: '2024-06-01T00:00:00Z',
      endDate: '2024-01-01T00:00:00Z', // Past date
    })

    expect(purchase.status === 'active').toBe(false)
    expect(isPaidPurchase(purchase)).toBe(true)
    // This combination should NOT grant access
    expect(purchase.status === 'active' && isPaidPurchase(purchase)).toBe(false)
  })
})
