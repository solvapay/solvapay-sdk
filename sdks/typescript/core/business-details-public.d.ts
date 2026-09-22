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

export declare function TAX_ID_TYPES(): readonly TaxIdType[]

export declare function isTaxIdType(value: string): value is TaxIdType

export declare function SUPPORTED_BUSINESS_COUNTRIES(): readonly string[]

export declare function BUSINESS_COUNTRY_DISPLAY_NAMES(): Record<string, string>

export declare function BUSINESS_COUNTRY_OPTIONS(): BusinessCountryOption[]

export declare function COUNTRY_TO_TAX_ID_TYPE(): Record<string, TaxIdType>

export declare function TAX_ID_EXAMPLE_BY_COUNTRY(): Record<string, string>

export declare function deriveTaxIdType(country: SupportedBusinessCountry): TaxIdType

export declare function isTaxIdType(value: unknown): value is TaxIdType

export declare function getTaxIdFieldLabel(country: SupportedBusinessCountry): string

export declare function getTaxIdExample(country: SupportedBusinessCountry): string

export declare function getTaxIdHelperText(country: SupportedBusinessCountry): string

export declare function POSTAL_CODE_REQUIRED_COUNTRIES(): string[]

export declare function STATE_REQUIRED_COUNTRIES(): string[]

export declare function isPostalCodeRequired(country: string): boolean

export declare function isStateRequired(country: string): boolean

export declare function getStateFieldLabel(country: string): string

export declare function getPostalCodeFieldLabel(country: string): string

export declare function getPostalCodePlaceholder(country: string): string

export declare function resolveBuyerCountry(input: {
  isBusiness: boolean
  country?: string
  customerCountry?: string
}): string | null

export declare function isCustomerAddressComplete(input: {
  isBusiness: boolean
  country?: string
  customerCountry?: string
  customerState?: string
  customerPostalCode?: string
}): boolean

export declare function getCustomerAddressFieldErrors(input: {
  isBusiness: boolean
  country?: string
  customerCountry?: string
  customerState?: string
  customerPostalCode?: string
}): Partial<Record<'country' | 'customerCountry' | 'customerState' | 'customerPostalCode', string>>

export type BusinessDetailsInput = {
  isBusiness: boolean
  businessName?: string
  country?: string
  customerCountry?: string
  customerName?: string
  customerState?: string
  customerPostalCode?: string
  taxId?: string
  taxIdType?: TaxIdType
}

export type BusinessDetails =
  | {
      isBusiness: false
      customerCountry?: SupportedBusinessCountry
      customerName?: string
      customerState?: string
      customerPostalCode?: string
    }
  | {
      isBusiness: true
      businessName?: string
      country: SupportedBusinessCountry
      customerCountry: SupportedBusinessCountry
      taxId?: string
      taxIdType?: TaxIdType
      customerName?: string
      customerState?: string
      customerPostalCode?: string
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

export declare function TAX_BEHAVIORS(): readonly string[]

export type TaxBehavior = 'auto' | 'inclusive' | 'exclusive'

export declare function TAX_EXCLUSIVE_CURRENCIES(): readonly string[]

export declare function resolveTaxBehavior(
  behavior: TaxBehavior,
  currency: string,
): 'inclusive' | 'exclusive'

export type TaxBreakdown = {
  subtotal: number
  taxAmount: number
  taxRate: number
  treatment: 'reverse_charge' | 'standard' | 'none' | 'not_collecting' | 'not_supported'
  total: number
  currency: string
  inclusive: boolean
}

export declare const REVERSE_CHARGE_NOTE: string
export declare const TAX_NOT_COLLECTED_NOTE: string

export declare function shouldShowTaxRow(
  treatment: TaxBreakdown['treatment'] | null | undefined,
): boolean

export declare function formatSubtotalLabel(
  treatment: TaxBreakdown['treatment'] | null | undefined,
): string

export declare function formatVatSummaryLabel(
  treatment: TaxBreakdown['treatment'] | null | undefined,
  taxRate: number,
): string

export declare function resolveTaxTreatmentNote(
  treatment: TaxBreakdown['treatment'] | null | undefined,
): string | null

export declare function formatPrice(
  amountMinor: number,
  currency: string,
  interval?: string | null,
  intervalCount?: number | null,
  free?: string | null,
  currencyDisplay?: string | null,
): string

export declare function toMajorUnits(amountMinor: number, currency: string): number
