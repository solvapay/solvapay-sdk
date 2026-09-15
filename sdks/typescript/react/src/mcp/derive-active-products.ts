import {
  deriveActiveProducts as deriveActiveProductsCore,
  type ActiveProduct,
} from '@solvapay/core'
import type { PurchaseInfo } from '@solvapay/server'

export type { ActiveProduct }

export function deriveActiveProducts(
  purchases: readonly PurchaseInfo[] | undefined,
  productRef?: string | null,
): ActiveProduct[] {
  return deriveActiveProductsCore(purchases ?? [], productRef ?? null)
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

/** Month + day only, UTC. Used on the F used-up line. */
export function formatShortDate(iso: string | null, locale: string): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

export function formatProductTerms(
  product: ActiveProduct,
  locale: string,
  extras?: { rate?: string | null },
): string {
  const parts: string[] = []
  if (product.planName) parts.push(product.planName)
  else if (product.isMetered) parts.push('Pay as you go')
  if (extras?.rate) parts.push(extras.rate)
  const since = formatSince(product.since, locale)
  if (since) parts.push(`since ${since}`)
  return parts.join(' · ')
}

export function formatAllowanceTerms(
  product: ActiveProduct,
  locale: string,
  extras?: {
    price?: string | null
    renewsOn?: string | null
    started?: boolean
    qualifier?: 'one time' | null
  },
): string {
  const parts: string[] = []
  if (product.planName) parts.push(product.planName)
  if (extras?.price) parts.push(extras.price)
  if (extras?.qualifier) parts.push(extras.qualifier)
  if (extras?.renewsOn) {
    const date = formatSince(extras.renewsOn, locale)
    if (date) parts.push(`renews ${date}`)
  } else if (extras?.started) {
    const date = formatSince(product.since, locale)
    if (date) parts.push(`started ${date}`)
  }
  return parts.join(' · ')
}
