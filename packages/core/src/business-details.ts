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

/** Per-country VAT / tax ID format validation (client-side pre-check). */
const TAX_ID_REGEX_BY_COUNTRY: Record<SupportedBusinessCountry, RegExp> = {
  AT: /^ATU\d{8}$/,
  BE: /^BE[01]\d{9}$/,
  BG: /^BG\d{9,10}$/,
  HR: /^HR\d{11}$/,
  CY: /^CY\d{8}[A-Z]$/,
  CZ: /^CZ\d{8,10}$/,
  DK: /^DK\d{8}$/,
  EE: /^EE\d{9}$/,
  FI: /^FI\d{8}$/,
  FR: /^FR[A-HJ-NP-Z0-9]{2}\d{9}$/,
  DE: /^DE\d{9}$/,
  GR: /^EL\d{9}$/,
  HU: /^HU\d{8}$/,
  IE: /^IE\d{7}[A-W][A-I]?$/,
  IT: /^IT\d{11}$/,
  LV: /^LV\d{11}$/,
  LT: /^LT(\d{9}|\d{12})$/,
  LU: /^LU\d{8}$/,
  MT: /^MT\d{8}$/,
  NL: /^NL\d{9}B\d{2}$/,
  PL: /^PL\d{10}$/,
  PT: /^PT\d{9}$/,
  RO: /^RO\d{2,10}$/,
  SK: /^SK\d{10}$/,
  SI: /^SI\d{8}$/,
  ES: /^ES[A-Z0-9]\d{7}[A-Z0-9]$/,
  SE: /^SE\d{12}$/,
  GB: /^GB(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/,
  US: /^\d{2}-?\d{7}$/,
}

export function deriveTaxIdType(country: SupportedBusinessCountry): TaxIdType {
  return COUNTRY_TO_TAX_ID_TYPE[country]
}

/** Stripe-aligned example values that pass {@link TAX_ID_REGEX_BY_COUNTRY} validation. */
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

const TAX_ID_FIELD_LABEL_BY_TYPE: Record<TaxIdType, string> = {
  eu_vat: 'VAT ID',
  gb_vat: 'VAT Number',
  us_ein: 'EIN (Employer Identification Number)',
}

export function getTaxIdFieldLabel(country: SupportedBusinessCountry): string {
  return TAX_ID_FIELD_LABEL_BY_TYPE[deriveTaxIdType(country)]
}

export function getTaxIdExample(country: SupportedBusinessCountry): string {
  return TAX_ID_EXAMPLE_BY_COUNTRY[country]
}

export function getTaxIdHelperText(country: SupportedBusinessCountry): string {
  const example = getTaxIdExample(country)
  const taxIdType = deriveTaxIdType(country)
  if (taxIdType === 'us_ein') {
    return `Enter your EIN, e.g. ${example}`
  }
  if (taxIdType === 'gb_vat') {
    return `Enter your full VAT number including the country code, e.g. ${example}`
  }
  return `Enter your full VAT ID including the country code, e.g. ${example}`
}

function isSupportedCountry(value: string): value is SupportedBusinessCountry {
  return (SUPPORTED_BUSINESS_COUNTRIES as readonly string[]).includes(value)
}

function normalizeTaxId(taxId: string): string {
  return taxId.trim().toUpperCase().replace(/\s+/g, '')
}

function isValidTaxIdForCountry(country: SupportedBusinessCountry, taxId: string): boolean {
  const normalized = normalizeTaxId(taxId)
  return TAX_ID_REGEX_BY_COUNTRY[country].test(normalized)
}

export const BusinessDetailsSchema = z
  .object({
    isBusiness: z.boolean(),
    businessName: z.string().optional(),
    country: z.string().optional(),
    customerCountry: z.string().optional(),
    taxId: z.string().optional(),
    taxIdType: z.enum(TAX_ID_TYPES).optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.isBusiness) {
      if (data.customerCountry?.trim()) {
        const customerCountryUpper = data.customerCountry.trim().toUpperCase()
        if (!isSupportedCountry(customerCountryUpper)) {
          ctx.addIssue({
            code: 'custom',
            message: 'Billing country is not supported for tax calculation',
            path: ['customerCountry'],
          })
        }
      }
      return
    }

    if (!data.businessName?.trim()) {
      ctx.addIssue({
        code: 'custom',
        message: 'Business name is required',
        path: ['businessName'],
      })
    }

    if (!data.country?.trim()) {
      ctx.addIssue({
        code: 'custom',
        message: 'Country is required',
        path: ['country'],
      })
      return
    }

    const countryUpper = data.country.trim().toUpperCase()
    if (!isSupportedCountry(countryUpper)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Country is not supported for business purchases',
        path: ['country'],
      })
      return
    }

    if (!data.taxId?.trim()) {
      ctx.addIssue({
        code: 'custom',
        message: 'Tax ID is required',
        path: ['taxId'],
      })
      return
    }

    const normalizedTaxId = normalizeTaxId(data.taxId)
    if (!isValidTaxIdForCountry(countryUpper, normalizedTaxId)) {
      ctx.addIssue({
        code: 'custom',
        message: `Enter a valid tax ID for ${countryUpper}`,
        path: ['taxId'],
      })
    }
  })
  .transform(data => {
    if (!data.isBusiness) {
      const customerCountry = data.customerCountry?.trim().toUpperCase()
      if (customerCountry && isSupportedCountry(customerCountry)) {
        return { isBusiness: false as const, customerCountry }
      }
      return { isBusiness: false as const }
    }

    const country = data.country!.trim().toUpperCase() as SupportedBusinessCountry
    const taxId = normalizeTaxId(data.taxId!)
    const taxIdType = deriveTaxIdType(country)

    return {
      isBusiness: true as const,
      businessName: data.businessName!.trim(),
      country,
      taxId,
      taxIdType,
    }
  })

export type BusinessDetailsInput = {
  isBusiness: boolean
  businessName?: string
  country?: string
  customerCountry?: string
  taxId?: string
  taxIdType?: TaxIdType
}

export type BusinessDetails =
  | { isBusiness: false; customerCountry?: SupportedBusinessCountry }
  | {
      isBusiness: true
      businessName: string
      country: SupportedBusinessCountry
      taxId: string
      taxIdType: TaxIdType
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

export function validateBusinessDetails(
  input: BusinessDetailsInput,
): ValidateBusinessDetailsResult {
  const parsed = BusinessDetailsSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: {
        issues: parsed.error.issues.map(issue => ({
          path: issue.path,
          message: issue.message,
        })),
      },
    }
  }
  return { success: true, data: parsed.data }
}

export const TAX_BEHAVIORS = ['auto', 'inclusive', 'exclusive'] as const
export type TaxBehavior = (typeof TAX_BEHAVIORS)[number]

export const TAX_EXCLUSIVE_CURRENCIES = ['USD', 'CAD'] as const

export function resolveTaxBehavior(
  behavior: TaxBehavior,
  currency: string,
): 'inclusive' | 'exclusive' {
  if (behavior === 'inclusive' || behavior === 'exclusive') {
    return behavior
  }
  const normalizedCurrency = currency.toUpperCase()
  return TAX_EXCLUSIVE_CURRENCIES.includes(
    normalizedCurrency as (typeof TAX_EXCLUSIVE_CURRENCIES)[number],
  )
    ? 'exclusive'
    : 'inclusive'
}

export type TaxBreakdown = {
  subtotal: number
  taxAmount: number
  taxRate: number
  treatment: 'reverse_charge' | 'standard' | 'none' | 'not_collecting'
  total: number
  currency: string
  inclusive: boolean
}
