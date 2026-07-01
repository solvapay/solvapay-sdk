export type TaxIdType = 'eu_vat' | 'gb_vat' | 'us_ein'

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

export type SupportedBusinessCountry = EuMemberCountry | 'GB' | 'US'

export declare const TAX_ID_TYPES: readonly TaxIdType[]

export declare const SUPPORTED_BUSINESS_COUNTRIES: readonly SupportedBusinessCountry[]

export declare const COUNTRY_TO_TAX_ID_TYPE: Record<SupportedBusinessCountry, TaxIdType>

export declare const TAX_ID_EXAMPLE_BY_COUNTRY: Record<SupportedBusinessCountry, string>

export declare function deriveTaxIdType(country: SupportedBusinessCountry): TaxIdType

export declare function getTaxIdFieldLabel(country: SupportedBusinessCountry): string

export declare function getTaxIdExample(country: SupportedBusinessCountry): string

export declare function getTaxIdHelperText(country: SupportedBusinessCountry): string

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

export declare function validateBusinessDetails(
  input: BusinessDetailsInput,
): ValidateBusinessDetailsResult

export declare const TAX_BEHAVIORS: readonly ['auto', 'inclusive', 'exclusive']

export type TaxBehavior = (typeof TAX_BEHAVIORS)[number]

export declare const TAX_EXCLUSIVE_CURRENCIES: readonly ['USD', 'CAD']

export declare function resolveTaxBehavior(
  behavior: TaxBehavior,
  currency: string,
): 'inclusive' | 'exclusive'

export type TaxBreakdown = {
  subtotal: number
  taxAmount: number
  taxRate: number
  treatment: 'reverse_charge' | 'standard' | 'none' | 'not_collecting'
  total: number
  currency: string
  inclusive: boolean
}
