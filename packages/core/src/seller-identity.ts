/**
 * Country-aware seller identity display resolver.
 * Presentation-only — maps stored identifiers to labeled rows for seller cards and receipts.
 */

import {
  SUPPORTED_BUSINESS_COUNTRIES,
  deriveTaxIdType,
  type SupportedBusinessCountry,
  type TaxIdType,
} from './business-details'

export type SellerIdentityRow = { label: string; value: string }

export type SellerIdentityDisplay = {
  taxIdentifier: SellerIdentityRow | null
  companyNumber: SellerIdentityRow | null
}

/** Display labels for seller identity rows (distinct from form field labels in getTaxIdFieldLabel). */
export const SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE: Record<TaxIdType, string> = {
  eu_vat: 'VAT number',
  gb_vat: 'VAT number',
  us_ein: 'EIN',
}

const DEFAULT_TAX_IDENTIFIER_DISPLAY_LABEL = 'Tax ID'
const COMPANY_NUMBER_LABEL = 'Company number'

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function toSupportedCountry(country: string | undefined): SupportedBusinessCountry | undefined {
  if (!country) return undefined
  const normalized = country.toUpperCase()
  return (SUPPORTED_BUSINESS_COUNTRIES as readonly string[]).includes(normalized)
    ? (normalized as SupportedBusinessCountry)
    : undefined
}

export function getSellerTaxIdentifierDisplayLabel(country: string | null | undefined): string {
  const supported = toSupportedCountry(normalizeOptionalString(country))
  if (supported) {
    return SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE[deriveTaxIdType(supported)]
  }
  return DEFAULT_TAX_IDENTIFIER_DISPLAY_LABEL
}

export function resolveSellerIdentityDisplay(input: {
  country?: string | null
  vatNumber?: string | null
  taxId?: string | null
  companyNumber?: string | null
}): SellerIdentityDisplay {
  const country = normalizeOptionalString(input.country)
  const supportedCountry = toSupportedCountry(country)
  const vatNumber = normalizeOptionalString(input.vatNumber)
  const taxId = normalizeOptionalString(input.taxId)
  const companyNumber = normalizeOptionalString(input.companyNumber)

  let taxValue: string | undefined
  if (supportedCountry && supportedCountry !== 'US') {
    taxValue = vatNumber ?? taxId
  } else if (supportedCountry === 'US') {
    taxValue = taxId ?? companyNumber
  } else {
    taxValue = taxId
  }

  const taxIdentifier: SellerIdentityRow | null = taxValue
    ? {
        label: getSellerTaxIdentifierDisplayLabel(country),
        value: taxValue,
      }
    : null

  const companyValue = companyNumber ?? taxId
  const companyNumberRow: SellerIdentityRow | null =
    companyValue && (!taxIdentifier || companyValue !== taxIdentifier.value)
      ? { label: COMPANY_NUMBER_LABEL, value: companyValue }
      : null

  return { taxIdentifier, companyNumber: companyNumberRow }
}
