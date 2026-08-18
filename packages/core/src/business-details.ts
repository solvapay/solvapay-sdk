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

export const BusinessDetailsSchema = z
  .object({
    isBusiness: z.boolean(),
    businessName: z.string().optional(),
    country: z.string().optional(),
    customerCountry: z.string().optional(),
    customerName: z.string().max(100).optional(),
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

    if (!data.isBusiness) {
      const customerCountry = data.customerCountry?.trim().toUpperCase()
      if (customerCountry && isStripeTaxBuyerCountry(customerCountry)) {
        return {
          isBusiness: false as const,
          customerCountry,
          ...(customerName && { customerName }),
        }
      }
      return {
        isBusiness: false as const,
        ...(customerName && { customerName }),
      }
    }

    const country = data.country!.trim().toUpperCase() as SupportedBusinessCountry
    const businessName = data.businessName?.trim()
    const taxId = data.taxId?.trim() ? normalizeTaxId(data.taxId) : undefined
    const taxIdType = taxId ? deriveTaxIdType(country) : undefined

    return {
      isBusiness: true as const,
      country,
      ...(businessName && { businessName }),
      ...(taxId && { taxId, ...(taxIdType && { taxIdType }) }),
      ...(customerName && { customerName }),
    }
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
