import { z } from 'zod'
import {
  STRIPE_TAX_BUYER_COUNTRIES,
  TAX_ID_TYPES,
  deriveTaxIdType,
  isStripeTaxBuyerCountry,
  isValidTaxIdForCountry,
  normalizeTaxId,
  type SupportedBusinessCountry,
  type TaxIdType,
} from './tax-jurisdictions'

export {
  BUSINESS_COUNTRY_DISPLAY_NAMES,
  COUNTRY_TO_TAX_ID_TYPE,
  SUPPORTED_BUSINESS_COUNTRIES,
  TAX_ID_EXAMPLE_BY_COUNTRY,
  TAX_ID_TYPES,
  deriveTaxIdType,
  getTaxIdExample,
  getTaxIdFieldLabel,
  getTaxIdHelperText,
  isTaxIdType,
  type EuMemberCountry,
  type SupportedBusinessCountry,
  type TaxIdType,
} from './tax-jurisdictions'

export type BusinessCountryOption = {
  value: SupportedBusinessCountry
  label: string
}

export const BUSINESS_COUNTRY_OPTIONS: BusinessCountryOption[] = STRIPE_TAX_BUYER_COUNTRIES.map(
  country => ({
    value: country.code,
    label: country.name,
  }),
).sort((a, b) => a.label.localeCompare(b.label))

/**
 * Countries that require a postal/ZIP code for Stripe Tax and confirm.
 * Keep in sync with `POSTAL_CODE_REQUIRED_COUNTRIES` in
 * `platform/apps/customer-app/src/components/customer/checkout/PaymentForm.tsx`.
 */
export const POSTAL_CODE_REQUIRED_COUNTRIES = ['US', 'CA', 'GB'] as const

/**
 * Countries that require a state/province for Stripe Tax and confirm.
 * Keep in sync with `STATE_REQUIRED_COUNTRIES` in
 * `platform/apps/customer-app/src/components/customer/checkout/PaymentForm.tsx`.
 */
export const STATE_REQUIRED_COUNTRIES = ['US', 'CA', 'IN'] as const

const POSTAL_CODE_REQUIRED_COUNTRY_SET = new Set<string>(POSTAL_CODE_REQUIRED_COUNTRIES)
const STATE_REQUIRED_COUNTRY_SET = new Set<string>(STATE_REQUIRED_COUNTRIES)

export function isPostalCodeRequired(country: string): boolean {
  return POSTAL_CODE_REQUIRED_COUNTRY_SET.has(country.trim().toUpperCase())
}

export function isStateRequired(country: string): boolean {
  return STATE_REQUIRED_COUNTRY_SET.has(country.trim().toUpperCase())
}

export function getStateFieldLabel(country: string): string {
  return country.trim().toUpperCase() === 'US' ? 'State' : 'Province'
}

export function getPostalCodeFieldLabel(country: string): string {
  return country.trim().toUpperCase() === 'US' ? 'ZIP code' : 'Postal code'
}

export function getPostalCodePlaceholder(country: string): string {
  return country.trim().toUpperCase() === 'US' ? '94103' : 'Required'
}

export function resolveBuyerCountry(input: {
  isBusiness: boolean
  country?: string
  customerCountry?: string
}): string | undefined {
  const customerCountry = input.customerCountry?.trim().toUpperCase()
  if (customerCountry) return customerCountry
  if (input.isBusiness) {
    const country = input.country?.trim().toUpperCase()
    if (country) return country
  }
  return undefined
}

export function isCustomerAddressComplete(input: {
  isBusiness: boolean
  country?: string
  customerCountry?: string
  customerState?: string
  customerPostalCode?: string
}): boolean {
  return Object.keys(getCustomerAddressFieldErrors(input)).length === 0
}

export function getCustomerAddressFieldErrors(input: {
  isBusiness: boolean
  country?: string
  customerCountry?: string
  customerState?: string
  customerPostalCode?: string
}): Partial<Record<'country' | 'customerCountry' | 'customerState' | 'customerPostalCode', string>> {
  const country = resolveBuyerCountry(input)
  if (!country) {
    return input.isBusiness
      ? { country: 'Country is required' }
      : { customerCountry: 'Country is required' }
  }

  const errors: Partial<
    Record<'country' | 'customerCountry' | 'customerState' | 'customerPostalCode', string>
  > = {}
  if (isPostalCodeRequired(country) && !input.customerPostalCode?.trim()) {
    errors.customerPostalCode = country === 'US' ? 'ZIP code is required' : 'Postal code is required'
  }
  if (isStateRequired(country) && !input.customerState?.trim()) {
    errors.customerState = country === 'US' ? 'State is required' : 'Province is required'
  }
  return errors
}

function pickAddressFields(data: {
  customerState?: string
  customerPostalCode?: string
}): { customerState?: string; customerPostalCode?: string } {
  const customerState = data.customerState?.trim()
  const customerPostalCode = data.customerPostalCode?.trim()
  return {
    ...(customerState && { customerState }),
    ...(customerPostalCode && { customerPostalCode }),
  }
}

export const BusinessDetailsSchema = z
  .object({
    isBusiness: z.boolean(),
    businessName: z.string().optional(),
    country: z.string().optional(),
    customerCountry: z.string().optional(),
    customerName: z.string().max(100).optional(),
    customerState: z.string().optional(),
    customerPostalCode: z.string().optional(),
    taxId: z.string().optional(),
    taxIdType: z.enum(TAX_ID_TYPES).optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.isBusiness) {
      if (data.customerCountry?.trim()) {
        const customerCountryUpper = data.customerCountry.trim().toUpperCase()
        if (!isStripeTaxBuyerCountry(customerCountryUpper)) {
          ctx.addIssue({
            code: 'custom',
            message: 'Billing country is not supported for tax calculation',
            path: ['customerCountry'],
          })
        }
      }
      return
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
    if (!isStripeTaxBuyerCountry(countryUpper)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Country is not supported for business purchases',
        path: ['country'],
      })
      return
    }

    if (data.taxId?.trim() && !isValidTaxIdForCountry(countryUpper, data.taxId)) {
      ctx.addIssue({
        code: 'custom',
        message: `Enter a valid tax ID for ${countryUpper}`,
        path: ['taxId'],
      })
    }
  })
  .transform(data => {
    const customerName = data.customerName?.trim()
    const address = pickAddressFields(data)

    if (!data.isBusiness) {
      const customerCountry = data.customerCountry?.trim().toUpperCase()
      if (customerCountry && isStripeTaxBuyerCountry(customerCountry)) {
        return {
          isBusiness: false as const,
          customerCountry,
          ...(customerName && { customerName }),
          ...address,
        }
      }
      return {
        isBusiness: false as const,
        ...(customerName && { customerName }),
      }
    }

    const country = data.country!.trim().toUpperCase() as SupportedBusinessCountry
    const customerCountryRaw = data.customerCountry?.trim().toUpperCase()
    const customerCountry =
      customerCountryRaw && isStripeTaxBuyerCountry(customerCountryRaw)
        ? customerCountryRaw
        : country
    const businessName = data.businessName?.trim()
    const taxId = data.taxId?.trim() ? normalizeTaxId(data.taxId) : undefined
    const taxIdType = taxId ? deriveTaxIdType(country) : undefined

    return {
      isBusiness: true as const,
      country,
      customerCountry,
      ...(businessName && { businessName }),
      ...(taxId && { taxId, ...(taxIdType && { taxIdType }) }),
      ...(customerName && { customerName }),
      ...address,
    }
  })

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
      country: SupportedBusinessCountry
      customerCountry: SupportedBusinessCountry
      businessName?: string
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

export function validateBusinessDetails(input: BusinessDetailsInput): ValidateBusinessDetailsResult {
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
  treatment: 'reverse_charge' | 'standard' | 'none' | 'not_collecting' | 'not_supported'
  total: number
  currency: string
  inclusive: boolean
}
