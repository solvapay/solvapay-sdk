import { z } from 'zod'

export const TAX_ID_TYPES = ['eu_vat', 'gb_vat', 'us_ein'] as const
export type TaxIdType = (typeof TAX_ID_TYPES)[number]

/** EU member states (ISO 3166-1 alpha-2) supported for eu_vat. */
const EU_MEMBER_COUNTRIES = [
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',
] as const

export type EuMemberCountry = (typeof EU_MEMBER_COUNTRIES)[number]

export const SUPPORTED_BUSINESS_COUNTRIES = [...EU_MEMBER_COUNTRIES, 'GB', 'US'] as const
export type SupportedBusinessCountry = (typeof SUPPORTED_BUSINESS_COUNTRIES)[number]

/** Stripe Connect English display names for supported business countries. */
export const BUSINESS_COUNTRY_DISPLAY_NAMES: Record<SupportedBusinessCountry, string> = {
  AT: 'Austria',
  BE: 'Belgium',
  BG: 'Bulgaria',
  HR: 'Croatia',
  CY: 'Cyprus',
  CZ: 'Czechia',
  DK: 'Denmark',
  EE: 'Estonia',
  FI: 'Finland',
  FR: 'France',
  DE: 'Germany',
  GR: 'Greece',
  HU: 'Hungary',
  IE: 'Ireland',
  IT: 'Italy',
  LV: 'Latvia',
  LT: 'Lithuania',
  LU: 'Luxembourg',
  MT: 'Malta',
  NL: 'Netherlands',
  PL: 'Poland',
  PT: 'Portugal',
  RO: 'Romania',
  SK: 'Slovakia',
  SI: 'Slovenia',
  ES: 'Spain',
  SE: 'Sweden',
  GB: 'United Kingdom',
  US: 'United States of America',
}

export type BusinessCountryOption = {
  value: SupportedBusinessCountry
  label: string
}

export const BUSINESS_COUNTRY_OPTIONS: BusinessCountryOption[] = SUPPORTED_BUSINESS_COUNTRIES.map(
  code => ({
    value: code,
    label: BUSINESS_COUNTRY_DISPLAY_NAMES[code],
  }),
).sort((a, b) => a.label.localeCompare(b.label))

export const COUNTRY_TO_TAX_ID_TYPE: Record<SupportedBusinessCountry, TaxIdType> = {
  AT: 'eu_vat',
  BE: 'eu_vat',
  BG: 'eu_vat',
  HR: 'eu_vat',
  CY: 'eu_vat',
  CZ: 'eu_vat',
  DK: 'eu_vat',
  EE: 'eu_vat',
  FI: 'eu_vat',
  FR: 'eu_vat',
  DE: 'eu_vat',
  GR: 'eu_vat',
  HU: 'eu_vat',
  IE: 'eu_vat',
  IT: 'eu_vat',
  LV: 'eu_vat',
  LT: 'eu_vat',
  LU: 'eu_vat',
  MT: 'eu_vat',
  NL: 'eu_vat',
  PL: 'eu_vat',
  PT: 'eu_vat',
  RO: 'eu_vat',
  SK: 'eu_vat',
  SI: 'eu_vat',
  ES: 'eu_vat',
  SE: 'eu_vat',
  GB: 'gb_vat',
  US: 'us_ein',
}

/** Stripe-aligned example values for tax ID fields. */
export const TAX_ID_EXAMPLE_BY_COUNTRY: Record<SupportedBusinessCountry, string> = {
  AT: 'ATU12345678',
  BE: 'BE0123456789',
  BG: 'BG0123456789',
  HR: 'HR12345678912',
  CY: 'CY12345678Z',
  CZ: 'CZ1234567890',
  DK: 'DK12345678',
  EE: 'EE123456789',
  FI: 'FI12345678',
  FR: 'FRAB123456789',
  DE: 'DE123456789',
  GR: 'EL123456789',
  HU: 'HU12345678',
  IE: 'IE1234567AB',
  IT: 'IT12345678912',
  LV: 'LV12345678912',
  LT: 'LT123456789',
  LU: 'LU12345678',
  MT: 'MT12345678',
  NL: 'NL123456789B12',
  PL: 'PL1234567890',
  PT: 'PT123456789',
  RO: 'RO1234567891',
  SK: 'SK1234567891',
  SI: 'SI12345678',
  ES: 'ESA1234567Z',
  SE: 'SE123456789123',
  GB: 'GB123456789',
  US: '12-3456789',
}

/**
 * Shape-only Zod schema (no validation refine). Runtime validation is Rust-only
 * via {@link validateBusinessDetails} after Step 52.
 */
export const BusinessDetailsSchema = z.object({
  isBusiness: z.boolean(),
  businessName: z.string().optional(),
  country: z.string().optional(),
  customerCountry: z.string().optional(),
  customerName: z.string().max(100).optional(),
  taxId: z.string().optional(),
  taxIdType: z.enum(TAX_ID_TYPES).optional(),
})

export type BusinessDetailsInput = {
  isBusiness: boolean
  businessName?: string
  country?: string
  customerCountry?: string
  customerName?: string
  taxId?: string
  taxIdType?: TaxIdType
}

export type BusinessDetails =
  | { isBusiness: false; customerCountry?: SupportedBusinessCountry; customerName?: string }
  | {
      isBusiness: true
      country: SupportedBusinessCountry
      businessName?: string
      taxId?: string
      taxIdType?: TaxIdType
      customerName?: string
    }

export type BusinessDetailsValidationIssue = {
  path: PropertyKey[]
  message: string
}

export type BusinessDetailsValidationError = {
  issues: BusinessDetailsValidationIssue[]
}

export type ValidateBusinessDetailsResult =
  | { success: true; data: BusinessDetails }
  | { success: false; error: BusinessDetailsValidationError }

export const TAX_BEHAVIORS = ['auto', 'inclusive', 'exclusive'] as const
export type TaxBehavior = (typeof TAX_BEHAVIORS)[number]

export const TAX_EXCLUSIVE_CURRENCIES = ['USD', 'CAD'] as const

export type TaxBreakdown = {
  subtotal: number
  taxAmount: number
  taxRate: number
  treatment: 'reverse_charge' | 'standard' | 'none' | 'not_collecting'
  total: number
  currency: string
  inclusive: boolean
}
