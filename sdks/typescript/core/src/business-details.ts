import { z } from 'zod'
import {
  BUSINESS_COUNTRY_DISPLAY_NAMES as readBusinessCountryDisplayNames,
  BUSINESS_COUNTRY_OPTIONS,
  COUNTRY_TO_TAX_ID_TYPE as readCountryToTaxIdType,
  POSTAL_CODE_REQUIRED_COUNTRIES,
  STATE_REQUIRED_COUNTRIES,
  SUPPORTED_BUSINESS_COUNTRIES,
  TAX_BEHAVIORS,
  TAX_EXCLUSIVE_CURRENCIES,
  TAX_ID_EXAMPLE_BY_COUNTRY as readTaxIdExampleByCountry,
  TAX_ID_TYPES as readTaxIdTypes,
  isTaxIdType as coreIsTaxIdType,
  validateBusinessDetails,
} from './native-core'

export {
  BUSINESS_COUNTRY_OPTIONS,
  POSTAL_CODE_REQUIRED_COUNTRIES,
  STATE_REQUIRED_COUNTRIES,
  SUPPORTED_BUSINESS_COUNTRIES,
  TAX_BEHAVIORS,
  TAX_EXCLUSIVE_CURRENCIES,
  validateBusinessDetails,
}

export type TaxIdType = 'eu_vat' | 'gb_vat' | 'us_ein' | 'jp_trn'

export type EuMemberCountry =
  | 'AT'
  | 'BE'
  | 'BG'
  | 'HR'
  | 'CY'
  | 'CZ'
  | 'DK'
  | 'EE'
  | 'FI'
  | 'FR'
  | 'DE'
  | 'GR'
  | 'HU'
  | 'IE'
  | 'IT'
  | 'LV'
  | 'LT'
  | 'LU'
  | 'MT'
  | 'NL'
  | 'PL'
  | 'PT'
  | 'RO'
  | 'SK'
  | 'SI'
  | 'ES'
  | 'SE'

export type SupportedBusinessCountry = EuMemberCountry | 'GB' | 'US' | 'JP'

export type BusinessCountryOption = {
  value: SupportedBusinessCountry
  label: string
}

export type TaxBehavior = 'auto' | 'inclusive' | 'exclusive'

export type TaxBreakdown = {
  subtotal: number
  taxAmount: number
  taxRate: number
  treatment: 'reverse_charge' | 'standard' | 'none' | 'not_collecting' | 'not_supported'
  total: number
  currency: string
  inclusive: boolean
}

export type {
  BusinessDetails,
  BusinessDetailsInput,
  BusinessDetailsValidationError,
  BusinessDetailsValidationIssue,
  ValidateBusinessDetailsResult,
} from './types/boundary.generated'

export function isTaxIdType(value: string): value is TaxIdType
export function isTaxIdType(value: unknown): value is TaxIdType
export function isTaxIdType(value: unknown): value is TaxIdType {
  return typeof value === 'string' && coreIsTaxIdType(value)
}

function unexpected(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  return typeof value
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readStringRecord(value: unknown, name: string): Record<string, string> {
  if (!isPlainRecord(value)) {
    throw new TypeError(`${name} returned ${unexpected(value)}, expected an object`)
  }
  const out: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') {
      throw new TypeError(`${name}.${key} returned ${unexpected(entry)}, expected a string`)
    }
    out[key] = entry
  }
  return out
}

/** Map of supported business country codes to display names. */
export function BUSINESS_COUNTRY_DISPLAY_NAMES(): Record<string, string> {
  return readStringRecord(readBusinessCountryDisplayNames(), 'BUSINESS_COUNTRY_DISPLAY_NAMES')
}

/** Map of business country codes to default tax ID types. */
export function COUNTRY_TO_TAX_ID_TYPE(): Record<string, TaxIdType> {
  const record = readStringRecord(readCountryToTaxIdType(), 'COUNTRY_TO_TAX_ID_TYPE')
  const out: Record<string, TaxIdType> = {}
  for (const [country, taxIdType] of Object.entries(record)) {
    if (!isTaxIdType(taxIdType)) {
      throw new TypeError(
        `COUNTRY_TO_TAX_ID_TYPE.${country} returned ${JSON.stringify(taxIdType)}, expected a tax ID type`,
      )
    }
    out[country] = taxIdType
  }
  return out
}

/** Map of country codes to example tax ID strings. */
export function TAX_ID_EXAMPLE_BY_COUNTRY(): Record<string, string> {
  return readStringRecord(readTaxIdExampleByCountry(), 'TAX_ID_EXAMPLE_BY_COUNTRY')
}

/** Frozen set of supported tax ID type values. */
export function TAX_ID_TYPES(): readonly TaxIdType[] {
  const values = readTaxIdTypes()
  const narrowed: TaxIdType[] = []
  for (const value of values) {
    if (!isTaxIdType(value)) {
      throw new TypeError(`TAX_ID_TYPES contained ${JSON.stringify(value)}, expected a tax ID type`)
    }
    narrowed.push(value)
  }
  return narrowed
}

const businessDetailsShape = z.object({
  isBusiness: z.boolean(),
  businessName: z.string().optional(),
  country: z.string().optional(),
  customerCountry: z.string().optional(),
  customerName: z.string().optional(),
  customerState: z.string().optional(),
  customerPostalCode: z.string().optional(),
  taxId: z.string().optional(),
  taxIdType: z.string().optional(),
})

/**
 * Shape check plus core validation. Country, tax-ID, and address rules come
 * from {@link validateBusinessDetails}; a successful parse returns the input
 * object unchanged.
 */
export const BusinessDetailsSchema = businessDetailsShape.superRefine((value, ctx) => {
  if (value.taxIdType !== undefined && !isTaxIdType(value.taxIdType)) {
    ctx.addIssue({
      code: 'custom',
      path: ['taxIdType'],
      message: 'Invalid tax ID type',
    })
    return
  }

  const result = validateBusinessDetails(value)
  if (result.success) return

  for (const issue of result.error.issues) {
    ctx.addIssue({
      code: 'custom',
      path: issue.path,
      message: issue.message,
    })
  }
})
