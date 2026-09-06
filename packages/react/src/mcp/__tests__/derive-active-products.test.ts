import { describe, expect, it } from 'vitest'
import type { PurchaseInfo } from '@solvapay/server'
import {
  deriveActiveProducts,
  formatAllowanceTerms,
  formatProductTerms,
  formatShortDate,
  formatSince,
} from '../derive-active-products'

const planPurchase: PurchaseInfo = {
  reference: 'pur_1',
  customerRef: 'cus_1',
  productName: 'Cool MCP',
  status: 'active',
  startDate: '2026-09-03T00:00:00Z',
  createdAt: '2026-09-03T00:00:00Z',
  amount: 0,
  currency: 'USD',
  isRecurring: false,
  planRef: 'pln_payg',
  planSnapshot: {
    reference: 'pln_payg',
    name: 'Pay as you go',
    currency: 'USD',
    price: 0,
    isMetered: true,
  },
}

const topup: PurchaseInfo = {
  reference: 'pur_top',
  customerRef: 'cus_1',
  status: 'active',
  startDate: '2026-09-04T00:00:00Z',
  createdAt: '2026-09-04T00:00:00Z',
  amount: 5000,
  currency: 'USD',
  isRecurring: false,
  origin: 'credit_topup',
}

describe('deriveActiveProducts', () => {
  it('copies plan name, rate flags and since from plan purchases', () => {
    expect(deriveActiveProducts([planPurchase, topup])).toEqual([
      {
        reference: 'pur_1',
        productName: 'Cool MCP',
        productRef: null,
        planName: 'Pay as you go',
        planRef: 'pln_payg',
        since: '2026-09-03T00:00:00Z',
        isMetered: true,
        amount: 0,
        currency: 'USD',
      },
    ])
  })

  it('returns an empty list when there are no plan purchases', () => {
    expect(deriveActiveProducts([topup])).toEqual([])
    expect(deriveActiveProducts(undefined)).toEqual([])
  })

  it('filters to bootstrap.productRef when provided', () => {
    const other: PurchaseInfo = {
      ...planPurchase,
      reference: 'pur_other',
      productRef: 'prd_other',
      productName: 'Other MCP',
    }
    const scoped: PurchaseInfo = { ...planPurchase, productRef: 'prd_cool' }
    expect(deriveActiveProducts([scoped, other], 'prd_cool')).toEqual([
      {
        reference: 'pur_1',
        productName: 'Cool MCP',
        productRef: 'prd_cool',
        planName: 'Pay as you go',
        planRef: 'pln_payg',
        since: '2026-09-03T00:00:00Z',
        isMetered: true,
        amount: 0,
        currency: 'USD',
      },
    ])
  })
})

describe('formatProductTerms', () => {
  it('joins the plan name and a short since date', () => {
    expect(formatSince('2026-09-03T00:00:00Z', 'en-US')).toBe('Sep 3, 2026')
    expect(formatShortDate('2026-10-01T00:00:00Z', 'en-US')).toBe('Oct 1')
    expect(formatProductTerms(deriveActiveProducts([planPurchase])[0]!, 'en-US')).toBe(
      'Pay as you go · since Sep 3, 2026',
    )
  })
})

describe('formatAllowanceTerms', () => {
  const starter: PurchaseInfo = {
    ...planPurchase,
    planRef: 'pln_starter',
    planSnapshot: {
      reference: 'pln_starter',
      name: 'Starter',
      currency: 'USD',
      price: 3000,
      isMetered: true,
    },
  }

  it('puts price and renews on a paid allowance plan', () => {
    expect(
      formatAllowanceTerms(deriveActiveProducts([starter])[0]!, 'en-US', {
        price: '$30/mo',
        renewsOn: '2026-09-12T00:00:00Z',
      }),
    ).toBe('Starter · $30/mo · renews Sep 12, 2026')
  })

  it('drops price on free and uses started', () => {
    const free: PurchaseInfo = {
      ...planPurchase,
      startDate: '2026-09-01T00:00:00Z',
      planRef: 'pln_free',
      planSnapshot: { reference: 'pln_free', name: 'Free', currency: 'USD', price: 0 },
    }
    expect(
      formatAllowanceTerms(deriveActiveProducts([free])[0]!, 'en-US', { started: true }),
    ).toBe('Free · started Sep 1, 2026')
  })

  it('qualifies a one-time plan and omits renews', () => {
    const oneTime: PurchaseInfo = {
      ...starter,
      planSnapshot: { ...starter.planSnapshot, name: 'Pro' },
    }
    expect(
      formatAllowanceTerms(deriveActiveProducts([oneTime])[0]!, 'en-US', {
        price: '$90',
        qualifier: 'one time',
      }),
    ).toBe('Pro · $90 · one time')
  })
})
