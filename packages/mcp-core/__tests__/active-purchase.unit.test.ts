import { describe, expect, it } from 'vitest'
import { isPlanPurchase, selectActivePlanPurchase } from '../src/active-purchase'

const free = {
  status: 'active' as const,
  productRef: 'prd_test',
  planSnapshot: { name: 'Free' },
  amount: 0,
  startDate: '2026-01-01T00:00:00.000Z',
}

const paid = {
  status: 'active' as const,
  productRef: 'prd_test',
  planSnapshot: { name: 'Pay as you go' },
  amount: 1000,
  startDate: '2026-02-01T00:00:00.000Z',
}

describe('isPlanPurchase', () => {
  it('rejects credit top-ups even when a snapshot is attached', () => {
    expect(
      isPlanPurchase({
        planSnapshot: { name: 'Top up' },
        metadata: { purpose: 'credit_topup' },
      }),
    ).toBe(false)
  })

  it('rejects credit top-ups stamped on origin when metadata.purpose is absent', () => {
    expect(
      isPlanPurchase({
        planSnapshot: { name: 'Credits' },
        origin: 'credit_topup',
      }),
    ).toBe(false)
  })

  it('accepts a plan snapshot without a top-up purpose', () => {
    expect(isPlanPurchase({ planSnapshot: { name: 'Pro' } })).toBe(true)
  })
})

describe('selectActivePlanPurchase', () => {
  it('prefers the newest purchase, using paid-over-free only as a same-timestamp tiebreak', () => {
    const newerFree = { ...free, startDate: '2026-03-01T00:00:00.000Z' }
    expect(selectActivePlanPurchase([newerFree, paid], 'prd_test')).toEqual(newerFree)
    const sameTimeFree = { ...free, startDate: paid.startDate }
    expect(selectActivePlanPurchase([sameTimeFree, paid], 'prd_test')).toEqual(paid)
  })

  it('ignores inactive rows and top-ups', () => {
    const cancelled = { ...paid, status: 'cancelled' as const }
    const topup = {
      status: 'active' as const,
      productRef: 'prd_test',
      planSnapshot: { name: 'Credits' },
      amount: 2500,
      startDate: '2026-03-01T00:00:00.000Z',
      metadata: { purpose: 'credit_topup' as const },
    }
    expect(selectActivePlanPurchase([cancelled, topup, free], 'prd_test')).toEqual(free)
  })

  it('tiebreaks equal paid-ness on startDate descending', () => {
    const olderPaid = { ...paid, startDate: '2026-01-15T00:00:00.000Z', amount: 500 }
    expect(selectActivePlanPurchase([olderPaid, paid], 'prd_test')).toEqual(paid)
  })

  it('excludes purchases for a different product when productRef is given', () => {
    const other = { ...paid, productRef: 'prd_other' }
    expect(selectActivePlanPurchase([other, free], 'prd_test')).toEqual(free)
  })

  it('excludes a purchase with no productRef from a scoped query', () => {
    const untagged = { ...paid, productRef: undefined }
    expect(selectActivePlanPurchase([untagged, free], 'prd_test')).toEqual(free)
    expect(selectActivePlanPurchase([untagged], 'prd_test')).toBeNull()
  })

  it('treats a missing status as active so incomplete snapshots still rank', () => {
    const noStatus = { ...paid, status: undefined, startDate: '2026-04-01T00:00:00.000Z' }
    expect(selectActivePlanPurchase([free, noStatus], 'prd_test')).toEqual(noStatus)
  })
})
