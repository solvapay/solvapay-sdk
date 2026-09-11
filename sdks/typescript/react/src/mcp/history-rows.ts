/**
 * Map `get_history` rows onto the designed fullscreen tables.
 *
 * Credit activity is account-wide (seven B2 fields → Event / When /
 * Credits / Balance). Charges are product-scoped (Charge / Date /
 * Amount). No receipt column.
 */

import type { CreditActivityEntry, CreditActivityType, PurchaseInfo } from '@solvapay/server'
import { formatSince } from './derive-active-products'
import { formatPrice } from '../utils/format'

export const CREDIT_ACTIVITY_TYPE_LABELS: Record<CreditActivityType, string> = {
  TOPUP: 'Top-up',
  USAGE: 'Usage',
  GRANT: 'Grant',
  REFUND: 'Refund',
  ADJUSTMENT: 'Adjustment',
}

export function creditEventTitle(entry: CreditActivityEntry): string {
  if (entry.productName) return entry.productName
  return CREDIT_ACTIVITY_TYPE_LABELS[entry.type]
}

export function formatCreditActivityReason(reason: string | null | undefined): string | null {
  const normalized = reason?.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
  if (!normalized) return null
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

export function creditEventSubtitle(entry: CreditActivityEntry): string | null {
  return formatCreditActivityReason(entry.reason)
}

export function formatCreditWhen(timestamp: string, locale: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid credit activity timestamp: ${timestamp}`)
  }
  const day = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date)
  const time = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC',
  }).format(date)
  return `${day}, ${time}`
}

export function formatSignedCredits(amount: number, locale: string): string {
  const formatted = new Intl.NumberFormat(locale).format(Math.abs(amount))
  if (amount > 0) return `+${formatted}`
  if (amount < 0) return `−${formatted}`
  return formatted
}

export function mapCreditActivityRow(
  entry: CreditActivityEntry,
  locale: string,
): {
  title: string
  subtitle: string | null
  when: string
  credits: string
  balance: string
} {
  return {
    title: creditEventTitle(entry),
    subtitle: creditEventSubtitle(entry),
    when: formatCreditWhen(entry.timestamp, locale),
    credits: formatSignedCredits(entry.amount, locale),
    balance: new Intl.NumberFormat(locale).format(entry.balance),
  }
}

export function chargeQualifier(purchase: PurchaseInfo): string {
  if (!purchase.isRecurring) return 'one time'
  return purchase.billingCycle ?? 'monthly'
}

export function mapChargeRow(
  purchase: PurchaseInfo,
  locale: string,
): {
  charge: string
  date: string
  amount: string
} {
  const name = purchase.planSnapshot?.name ?? purchase.productName
  if (!name) {
    throw new Error(`Charge row ${purchase.reference} has no plan or product name`)
  }
  const dateIso = purchase.paidAt ?? purchase.createdAt ?? purchase.startDate
  const date = formatSince(dateIso, locale)
  if (!date) {
    throw new Error(`Charge row ${purchase.reference} has no usable date`)
  }
  return {
    charge: `${name} · ${chargeQualifier(purchase)}`,
    date,
    amount: formatPrice(purchase.originalAmount ?? purchase.amount, purchase.currency, {
      locale,
      free: '',
    }),
  }
}

export function formatMerchantPlace(merchant: {
  city?: string | null
  stateOrCounty?: string | null
}): string | null {
  const city = merchant.city?.trim()
  const state = merchant.stateOrCounty?.trim()
  if (city && state) return `${city}, ${state}`
  return city || state || null
}

export function websiteHostLabel(url: string): string {
  const parsed = new URL(url)
  return parsed.hostname.replace(/^www\./, '')
}
