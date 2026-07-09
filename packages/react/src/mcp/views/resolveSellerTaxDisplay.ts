import {
  getTaxIdFieldLabel,
  SUPPORTED_BUSINESS_COUNTRIES,
  type SupportedBusinessCountry,
} from '@solvapay/core'
import type { Merchant } from '../../types'

/**
 * Country-smart tax-identifier resolution for the seller card, mirroring
 * hosted checkout's two behaviors:
 *
 * - VAT-required countries (every supported business country except the US)
 *   surface the merchant's VAT number under a `'VAT number'` label.
 * - Every other supported country surfaces its tax id under the
 *   `@solvapay/core` field label (US → EIN, EU → VAT ID, GB → VAT Number).
 *
 * Unsupported countries (or a merchant with no usable identifier) resolve to
 * `not_provided` so the card can drop the row entirely.
 */
export type SellerTaxDisplay =
  | {
      kind: 'provided'
      value: string
      label: string
    }
  | {
      kind: 'not_provided'
    }

const VAT_NUMBER_LABEL = 'VAT number'

function normalize(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function toSupportedCountry(country: string | undefined): SupportedBusinessCountry | undefined {
  const normalized = normalize(country)?.toUpperCase()
  if (!normalized) return undefined
  return (SUPPORTED_BUSINESS_COUNTRIES as readonly string[]).includes(normalized)
    ? (normalized as SupportedBusinessCountry)
    : undefined
}

export function resolveSellerTaxDisplay(merchant: Merchant | null | undefined): SellerTaxDisplay {
  if (!merchant) return { kind: 'not_provided' }

  const country = toSupportedCountry(merchant.country)
  const vatNumber = normalize(merchant.vatNumber)
  const taxId = normalize(merchant.taxId)

  // VAT-required = supported country that is not the US.
  if (country && country !== 'US' && vatNumber) {
    return { kind: 'provided', value: vatNumber, label: VAT_NUMBER_LABEL }
  }

  if (country && taxId) {
    return { kind: 'provided', value: taxId, label: getTaxIdFieldLabel(country) }
  }

  return { kind: 'not_provided' }
}

/**
 * Derives the company/organization-number line, preferring `companyNumber`
 * and falling back to `taxId`. Returns `null` when there is nothing to show
 * or when the value would duplicate the tax-identifier row.
 */
export function resolveSellerOrganizationNumberDisplay(
  merchant: Merchant | null | undefined,
  taxDisplay: SellerTaxDisplay,
): string | null {
  const organizationNumber = normalize(merchant?.companyNumber) ?? normalize(merchant?.taxId)
  if (!organizationNumber) return null

  if (taxDisplay.kind === 'provided' && organizationNumber === taxDisplay.value) {
    return null
  }

  return organizationNumber
}
