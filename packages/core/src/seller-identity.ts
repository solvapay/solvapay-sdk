/**
 * Country-aware seller identity display resolver.
 * Presentation-only — maps stored identifiers to labeled rows for seller cards and receipts.
 */

import {
  DEFAULT_TAX_IDENTIFIER_DISPLAY_LABEL,
  SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE,
  deriveTaxIdType,
  isStripeTaxBuyerCountry,
} from './tax-jurisdictions'

export {
  DEFAULT_TAX_IDENTIFIER_DISPLAY_LABEL,
  SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE,
}

export type SellerIdentityRow = { label: string; value: string }

export type SellerIdentityDisplay = {
  taxIdentifier: SellerIdentityRow | null
  companyNumber: SellerIdentityRow | null
}

const COMPANY_NUMBER_LABEL = 'Company number'

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function getSellerTaxIdentifierDisplayLabel(country: string | null | undefined): string {
  const normalized = normalizeOptionalString(country)?.toUpperCase()
  if (normalized && isStripeTaxBuyerCountry(normalized)) {
    const type = deriveTaxIdType(normalized)
    if (type) {
      return SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE[type] ?? DEFAULT_TAX_IDENTIFIER_DISPLAY_LABEL
    }
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
  const supportedCountry =
    country && isStripeTaxBuyerCountry(country.toUpperCase()) ? country.toUpperCase() : undefined
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
