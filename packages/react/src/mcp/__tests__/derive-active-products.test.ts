import { describe, expect, it } from 'vitest'
import type { PurchaseInfo } from '@solvapay/server'
import {
  deriveActiveProducts,
  formatProductTerms,
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
})

describe('formatProductTerms', () => {
  it('joins the plan name and a short since date', () => {
    expect(formatSince('2026-09-03T00:00:00Z', 'en-US')).toBe('Sep 3, 2026')
    expect(formatProductTerms(deriveActiveProducts([planPurchase])[0]!, 'en-US')).toBe(
      'Pay as you go · since Sep 3, 2026',
    )
  })
})
