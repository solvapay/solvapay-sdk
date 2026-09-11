import { describe, expect, it } from 'vitest'
import type { CreditActivityEntry, PurchaseInfo } from '@solvapay/server'
import {
  CREDIT_ACTIVITY_TYPE_LABELS,
  creditEventSubtitle,
  creditEventTitle,
  formatCreditWhen,
  formatMerchantPlace,
  formatSignedCredits,
  mapChargeRow,
  mapCreditActivityRow,
  websiteHostLabel,
} from '../history-rows'

const usage: CreditActivityEntry = {
  type: 'USAGE',
  amount: -200,
  balance: 599_800,
  productName: 'Cool MCP',
  productRef: 'prd_widget',
  timestamp: '2026-09-05T14:22:00.000Z',
}

describe('CREDIT_ACTIVITY_TYPE_LABELS', () => {
  it('copies the platform fallback titles, with Top-up hyphenated', () => {
    expect(CREDIT_ACTIVITY_TYPE_LABELS).toEqual({
      TOPUP: 'Top-up',
      USAGE: 'Usage',
      GRANT: 'Grant',
      REFUND: 'Refund',
      ADJUSTMENT: 'Adjustment',
    })
  })
})

describe('creditEventTitle', () => {
  it('uses productName when present, including USAGE rows', () => {
    expect(creditEventTitle(usage)).toBe('Cool MCP')
    expect(creditEventTitle({ ...usage, type: 'TOPUP', productName: 'Cool MCP' })).toBe('Cool MCP')
  })

  it('falls back to the type label when productName is missing', () => {
    expect(creditEventTitle({ ...usage, productName: undefined })).toBe('Usage')
    expect(
      creditEventTitle({
        type: 'TOPUP',
        amount: 500_000,
        balance: 602_700,
        timestamp: '2026-08-31T11:03:00.000Z',
      }),
    ).toBe('Top-up')
  })
})

describe('creditEventSubtitle', () => {
  it('humanizes snake_case reason and omits an empty line', () => {
    expect(creditEventSubtitle({ ...usage, reason: 'promo_credit' })).toBe('Promo credit')
    expect(creditEventSubtitle(usage)).toBeNull()
    expect(creditEventSubtitle({ ...usage, reason: '   ' })).toBeNull()
  })

  it('does not invent a tool name when reason is missing', () => {
    expect(creditEventSubtitle({ ...usage, reason: undefined })).toBeNull()
  })
})

describe('formatCreditWhen', () => {
  it('prints Sep 5, 14:22 in UTC', () => {
    expect(formatCreditWhen('2026-09-05T14:22:00.000Z', 'en-US')).toBe('Sep 5, 14:22')
  })
})

describe('formatSignedCredits', () => {
  it('signs outflows with a minus and inflows with a plus', () => {
    expect(formatSignedCredits(-200, 'en-US')).toBe('−200')
    expect(formatSignedCredits(500_000, 'en-US')).toBe('+500,000')
  })
})

describe('mapCreditActivityRow', () => {
  it('maps the seven B2 fields onto the four designed columns', () => {
    expect(mapCreditActivityRow(usage, 'en-US')).toEqual({
      title: 'Cool MCP',
      subtitle: null,
      when: 'Sep 5, 14:22',
      credits: '−200',
      balance: '599,800',
    })
  })
})

describe('mapChargeRow', () => {
  const monthly: PurchaseInfo = {
    reference: 'pur_starter',
    customerRef: 'cus_abc',
    productName: 'Widget API',
    status: 'active',
    startDate: '2026-08-12T00:00:00Z',
    createdAt: '2026-08-12T00:00:00Z',
    amount: 3000,
    currency: 'USD',
    isRecurring: true,
    billingCycle: 'monthly',
    planSnapshot: { name: 'Starter', currency: 'USD', price: 3000 },
  }

  it('labels a recurring purchase as plan · cycle with no receipt', () => {
    expect(mapChargeRow(monthly, 'en-US')).toEqual({
      charge: 'Starter · monthly',
      date: 'Aug 12, 2026',
      amount: '$30',
    })
  })

  it('labels a one-time purchase as plan · one time', () => {
    const oneTime: PurchaseInfo = {
      ...monthly,
      isRecurring: false,
      billingCycle: undefined,
      amount: 9000,
      createdAt: '2026-08-18T00:00:00Z',
      planSnapshot: { name: 'Pro', currency: 'USD', price: 9000 },
    }
    expect(mapChargeRow(oneTime, 'en-US')).toEqual({
      charge: 'Pro · one time',
      date: 'Aug 18, 2026',
      amount: '$90',
    })
  })
})

describe('formatMerchantPlace', () => {
  it('joins city and stateOrCounty and omits the Stripe sentence', () => {
    expect(formatMerchantPlace({ city: 'San Francisco', stateOrCounty: 'CA' })).toBe(
      'San Francisco, CA',
    )
    expect(formatMerchantPlace({ city: 'London', stateOrCounty: 'Greater London' })).toBe(
      'London, Greater London',
    )
    expect(formatMerchantPlace({ city: 'Stockholm' })).toBe('Stockholm')
    expect(formatMerchantPlace({})).toBeNull()
  })
})

describe('websiteHostLabel', () => {
  it('strips the scheme for the designed host line', () => {
    expect(websiteHostLabel('https://aaa.com')).toBe('aaa.com')
    expect(websiteHostLabel('https://www.aaa.com/path')).toBe('aaa.com')
  })
})
