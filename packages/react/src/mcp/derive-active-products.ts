import type { PurchaseInfo } from '@solvapay/server'

export interface ActiveProduct {
  reference: string
  productName: string
  planName: string | null
  planRef: string | null
  since: string | null
  isMetered: boolean
  amount: number
  currency: string
}

const TOPUP_ORIGINS = new Set(['credit_topup'])

function isPlanPurchase(purchase: PurchaseInfo): boolean {
  if (purchase.origin && TOPUP_ORIGINS.has(purchase.origin)) return false
  return purchase.planSnapshot != null || Boolean(purchase.planRef)
}

export function deriveActiveProducts(
  purchases: readonly PurchaseInfo[] | undefined,
): ActiveProduct[] {
  if (!purchases) return []
  return purchases.filter(isPlanPurchase).map(purchase => ({
    reference: purchase.reference,
    productName: purchase.productName ?? 'Product',
    planName: purchase.planSnapshot?.name ?? null,
    planRef: purchase.planRef ?? purchase.planSnapshot?.reference ?? null,
    since: purchase.startDate ?? null,
    isMetered: Boolean(purchase.planSnapshot?.isMetered),
    amount: purchase.amount,
    currency: purchase.currency,
  }))
}

export function formatSince(iso: string | null, locale: string): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

export function formatProductTerms(
  product: ActiveProduct,
  locale: string,
): string {
  const parts: string[] = []
  if (product.planName) parts.push(product.planName)
  else if (product.isMetered) parts.push('Pay as you go')
  const since = formatSince(product.since, locale)
  if (since) parts.push(`since ${since}`)
  return parts.join(' · ')
}
