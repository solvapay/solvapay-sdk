/**
 * Portable TypeScript fallbacks for `@solvapay/core` sync helpers.
 *
 * Used only when no napi / WASM binding is installed (the `ui://` widget).
 * Rust remains the source of truth wherever a binding exists.
 */

import {
  BUSINESS_COUNTRY_OPTIONS,
  COUNTRY_TO_TAX_ID_TYPE,
  SUPPORTED_BUSINESS_COUNTRIES,
  TAX_EXCLUSIVE_CURRENCIES,
  TAX_ID_EXAMPLE_BY_COUNTRY,
  type SupportedBusinessCountry,
  type TaxIdType,
} from './business-details'
import { installCoreSyncFallbacks } from './native-dispatch'
import { SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE } from './seller-identity'
import type { BillingCycle, Charge, SellerIdentityDisplay } from './types/boundary.generated'

const ZERO_DECIMAL = new Set([
  'bif',
  'clp',
  'djf',
  'gnf',
  'jpy',
  'kmf',
  'krw',
  'mga',
  'pyg',
  'rwf',
  'ugx',
  'vnd',
  'vuv',
  'xaf',
  'xof',
  'xpf',
])

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
  JP: /^T\d{13}$/,
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

const TAX_ID_FIELD_LABEL: Record<TaxIdType, string> = {
  eu_vat: 'VAT ID',
  gb_vat: 'VAT Number',
  us_ein: 'EIN (Employer Identification Number)',
  jp_trn: 'Registration number (Tōroku Bangō)',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asRecord(args: unknown): Record<string, unknown> {
  if (!isRecord(args)) {
    throw new Error('portable fallback expected an object argument')
  }
  return args
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function optionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null
  return typeof value === 'string' ? value : null
}

function isSupportedCountry(code: string): code is SupportedBusinessCountry {
  return (SUPPORTED_BUSINESS_COUNTRIES as readonly string[]).includes(code)
}

function isZeroDecimalCurrency(currency: string): boolean {
  return ZERO_DECIMAL.has(currency.toLowerCase())
}

function minorUnitsPerMajor(currency: string): number {
  return isZeroDecimalCurrency(currency) ? 1 : 100
}

function creditsToDisplayMinorUnits(input: {
  credits: number
  creditsPerMinorUnit: number
  displayExchangeRate: number
  displayCurrency: string
}): number | null {
  if (input.creditsPerMinorUnit <= 0) return null
  const rate = input.displayExchangeRate === 0 ? 1 : input.displayExchangeRate
  const usdMajor = input.credits / input.creditsPerMinorUnit / 100
  const minor = usdMajor * rate * minorUnitsPerMajor(input.displayCurrency)
  return Math.round(minor)
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function toSupportedCountry(country: string | null): SupportedBusinessCountry | null {
  const normalized = normalizeOptionalString(country)
  if (normalized === null) return null
  const upper = normalized.toUpperCase()
  return isSupportedCountry(upper) ? upper : null
}

function getSellerTaxIdentifierDisplayLabel(country: string | null): string {
  const supported = toSupportedCountry(country)
  if (supported === null) return 'Tax ID'
  return SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE[COUNTRY_TO_TAX_ID_TYPE[supported]]
}

function resolveSellerIdentityDisplay(input: {
  country: string | null
  vatNumber: string | null
  taxId: string | null
  companyNumber: string | null
}): SellerIdentityDisplay {
  const country = normalizeOptionalString(input.country)
  const supportedCountry = toSupportedCountry(country)
  const vatNumber = normalizeOptionalString(input.vatNumber)
  const taxId = normalizeOptionalString(input.taxId)
  const companyNumber = normalizeOptionalString(input.companyNumber)

  const taxValue =
    supportedCountry === 'US'
      ? (taxId ?? companyNumber)
      : supportedCountry !== null
        ? (vatNumber ?? taxId)
        : taxId

  const taxIdentifier =
    taxValue === null
      ? null
      : {
          label: getSellerTaxIdentifierDisplayLabel(country),
          value: taxValue,
        }

  const companyValue = companyNumber ?? taxId
  const companyNumberRow =
    companyValue !== null && (taxIdentifier === null || taxIdentifier.value !== companyValue)
      ? { label: 'Company number', value: companyValue }
      : null

  return { taxIdentifier, companyNumber: companyNumberRow }
}

function normalizeTaxId(taxId: string): string {
  return taxId.trim().replace(/\s+/g, '').toUpperCase()
}

function validateBusinessDetails(input: Record<string, unknown>): unknown {
  const customerName = asString(input.customerName)
  if (customerName !== undefined && [...customerName].length > 100) {
    return {
      success: false,
      error: {
        issues: [
          {
            path: ['customerName'],
            message: 'Too big: expected string to have <=100 characters',
          },
        ],
      },
    }
  }

  const isBusiness = input.isBusiness === true
  if (!isBusiness) {
    const customerCountryRaw = asString(input.customerCountry)
    if (customerCountryRaw !== undefined) {
      const trimmed = customerCountryRaw.trim()
      if (trimmed.length > 0 && !isSupportedCountry(trimmed.toUpperCase())) {
        return {
          success: false,
          error: {
            issues: [
              {
                path: ['customerCountry'],
                message: 'Billing country is not supported for tax calculation',
              },
            ],
          },
        }
      }
    }

    const data: Record<string, unknown> = { isBusiness: false }
    const name = customerName?.trim()
    if (name) data.customerName = name
    if (customerCountryRaw !== undefined) {
      const trimmed = customerCountryRaw.trim()
      if (trimmed.length > 0) {
        const upper = trimmed.toUpperCase()
        if (isSupportedCountry(upper)) data.customerCountry = upper
      }
    }
    return { success: true, data }
  }

  const countryRaw = asString(input.country)
  if (countryRaw === undefined) {
    return {
      success: false,
      error: { issues: [{ path: ['country'], message: 'Country is required' }] },
    }
  }
  const countryTrimmed = countryRaw.trim()
  if (countryTrimmed.length === 0) {
    return {
      success: false,
      error: { issues: [{ path: ['country'], message: 'Country is required' }] },
    }
  }
  const countryUpper = countryTrimmed.toUpperCase()
  if (!isSupportedCountry(countryUpper)) {
    return {
      success: false,
      error: {
        issues: [
          {
            path: ['country'],
            message: 'Country is not supported for business purchases',
          },
        ],
      },
    }
  }

  const taxIdRaw = asString(input.taxId)
  if (taxIdRaw !== undefined && taxIdRaw.trim().length > 0) {
    if (!TAX_ID_REGEX_BY_COUNTRY[countryUpper].test(normalizeTaxId(taxIdRaw))) {
      return {
        success: false,
        error: {
          issues: [
            {
              path: ['taxId'],
              message: `Enter a valid tax ID for ${countryUpper}`,
            },
          ],
        },
      }
    }
  }

  const data: Record<string, unknown> = { isBusiness: true, country: countryUpper }
  const businessName = asString(input.businessName)?.trim()
  if (businessName) data.businessName = businessName
  const taxId =
    taxIdRaw !== undefined && taxIdRaw.trim().length > 0 ? normalizeTaxId(taxIdRaw) : undefined
  if (taxId) {
    data.taxId = taxId
    data.taxIdType = COUNTRY_TO_TAX_ID_TYPE[countryUpper]
  }
  const name = customerName?.trim()
  if (name) data.customerName = name
  return { success: true, data }
}

function deriveTaxIdType(country: string): TaxIdType | null {
  return isSupportedCountry(country) ? COUNTRY_TO_TAX_ID_TYPE[country] : null
}

function getTaxIdExample(country: string): string | null {
  return isSupportedCountry(country) ? TAX_ID_EXAMPLE_BY_COUNTRY[country] : null
}

function getTaxIdFieldLabel(country: string): string | null {
  const taxType = deriveTaxIdType(country)
  return taxType === null ? null : TAX_ID_FIELD_LABEL[taxType]
}

function getTaxIdHelperText(country: string): string | null {
  const example = getTaxIdExample(country)
  const taxType = deriveTaxIdType(country)
  if (example === null || taxType === null) return null
  if (taxType === 'us_ein') return `Enter your EIN, e.g. ${example}`
  if (taxType === 'gb_vat') {
    return `Enter your full VAT number including the country code, e.g. ${example}`
  }
  if (taxType === 'eu_vat') {
    return `Enter your full VAT ID including the country code, e.g. ${example}`
  }
  return `Enter your tax ID, e.g. ${example}`
}

function resolveTaxBehavior(behavior: string, currency: string): string | null {
  if (behavior === 'inclusive' || behavior === 'exclusive') return behavior
  if (behavior !== 'auto') return null
  const normalized = currency.toUpperCase()
  return (TAX_EXCLUSIVE_CURRENCIES as readonly string[]).includes(normalized)
    ? 'exclusive'
    : 'inclusive'
}

function isStrictlyPositive(n: number): boolean {
  return n > 0
}

function optionsOf(priced: unknown): Record<string, unknown>[] {
  if (!isRecord(priced)) return []
  const options = priced.options
  if (!Array.isArray(options)) return []
  return options.filter(isRecord)
}

function asCharge(option: Record<string, unknown>): Charge | null {
  if (option.kind !== 'charge') return null
  const per = option.per
  if (per !== 'flat' && per !== 'unit' && per !== 'seat') return null
  const amountMinor = asNumber(option.amountMinor)
  const currency = asString(option.currency)
  if (amountMinor === undefined || currency === undefined) return null
  const charge: Charge = { per, amountMinor, currency }
  const meter = asString(option.meter)
  if (meter !== undefined) charge.meter = meter
  if (option.oneTime === true) charge.oneTime = true
  return charge
}

function charges(priced: unknown): Charge[] {
  return optionsOf(priced).flatMap(option => {
    const charge = asCharge(option)
    return charge === null ? [] : [charge]
  })
}

function headlineCharges(priced: unknown): Charge[] {
  const flat = charges(priced).filter(charge => charge.per === 'flat')
  const base = flat.filter(charge => charge.oneTime !== true)
  const source = base.length === 0 ? flat : base
  const seen = new Set<string>()
  return source.filter(charge => {
    const key = charge.currency.toUpperCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function perUnitCharge(priced: unknown, meter: string | null): Charge | null {
  const unit = charges(priced).filter(charge => charge.per === 'unit')
  if (meter !== null && meter.length > 0) {
    return unit.find(charge => charge.meter === meter) ?? null
  }
  return unit[0] ?? null
}

function billingCycle(priced: unknown): BillingCycle | null {
  for (const option of optionsOf(priced)) {
    if (option.kind !== 'billingCycle') continue
    const interval = asString(option.interval)
    if (interval !== 'week' && interval !== 'month' && interval !== 'year') continue
    const count = asNumber(option.count)
    const cycle: BillingCycle = { interval }
    if (count !== undefined && count > 1) cycle.count = count
    return cycle
  }
  return null
}

function trialDays(priced: unknown): number | null {
  for (const option of optionsOf(priced)) {
    if (option.kind !== 'trial') continue
    const days = asNumber(option.days)
    if (days !== undefined && days > 0) return Math.trunc(days)
  }
  return null
}

function includedUnits(priced: unknown, meter: string | null): number | null {
  for (const option of optionsOf(priced)) {
    if (option.kind !== 'limit') continue
    if (meter !== null && meter.length > 0 && option.meter !== meter) continue
    const cap = asNumber(option.cap)
    if (cap !== undefined) return Math.trunc(cap)
  }
  return null
}

function peggedCreditsPerUnit(
  chargeMinor: number,
  creditsPerMinorUnit: number,
  usdToChargeRate: number | null,
): number {
  if (!isStrictlyPositive(chargeMinor) || !isStrictlyPositive(creditsPerMinorUnit)) return 0
  const rate = usdToChargeRate !== null && usdToChargeRate > 0 ? usdToChargeRate : 1
  return Math.round((chargeMinor / rate) * creditsPerMinorUnit)
}

function creditsPerUnitFromBalance(
  priced: unknown,
  balance: unknown,
  meter: string | null,
): number | null {
  const charge = perUnitCharge(priced, meter)
  if (charge === null || !isStrictlyPositive(charge.amountMinor)) return null
  if (!isRecord(balance)) return null
  const displayCurrency = asString(balance.displayCurrency)
  const creditsPerMinorUnit = asNumber(balance.creditsPerMinorUnit)
  if (displayCurrency === undefined || creditsPerMinorUnit === undefined) return null
  if (charge.currency.toLowerCase() !== displayCurrency.toLowerCase()) return null
  const rate = asNumber(balance.displayExchangeRate) ?? null
  const credits = peggedCreditsPerUnit(charge.amountMinor, creditsPerMinorUnit, rate)
  return credits > 0 ? credits : null
}

export function installPortableCoreFallbacks(): void {
  installCoreSyncFallbacks({
  validateBusinessDetails: args => validateBusinessDetails(asRecord(args)),
  deriveTaxIdType: args => deriveTaxIdType(asString(asRecord(args).country) ?? ''),
  resolveTaxBehavior: args => {
    const rec = asRecord(args)
    return resolveTaxBehavior(asString(rec.behavior) ?? '', asString(rec.currency) ?? '')
  },
  getTaxIdExample: args => getTaxIdExample(asString(asRecord(args).country) ?? ''),
  getTaxIdFieldLabel: args => getTaxIdFieldLabel(asString(asRecord(args).country) ?? ''),
  getTaxIdHelperText: args => getTaxIdHelperText(asString(asRecord(args).country) ?? ''),
  getBusinessCountryOptions: () => BUSINESS_COUNTRY_OPTIONS,
  creditsToDisplayMinorUnits: args => {
    const rec = asRecord(args)
    return creditsToDisplayMinorUnits({
      credits: asNumber(rec.credits) ?? 0,
      creditsPerMinorUnit: asNumber(rec.creditsPerMinorUnit) ?? 0,
      displayExchangeRate: asNumber(rec.displayExchangeRate) ?? 0,
      displayCurrency: asString(rec.displayCurrency) ?? '',
    })
  },
  isZeroDecimalCurrency: args => isZeroDecimalCurrency(asString(asRecord(args).currency) ?? ''),
  minorUnitsPerMajor: args => minorUnitsPerMajor(asString(asRecord(args).currency) ?? ''),
  resolveSellerIdentityDisplay: args => {
    const rec = asRecord(args)
    return resolveSellerIdentityDisplay({
      country: optionalString(rec.country),
      vatNumber: optionalString(rec.vatNumber),
      taxId: optionalString(rec.taxId),
      companyNumber: optionalString(rec.companyNumber),
    })
  },
  getSellerTaxIdentifierDisplayLabel: args =>
    getSellerTaxIdentifierDisplayLabel(optionalString(asRecord(args).country)),
  SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE: () => SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE,
  headlineCharges: args => headlineCharges(asRecord(args).priced),
  perUnitCharge: args => {
    const rec = asRecord(args)
    return perUnitCharge(rec.priced, optionalString(rec.meter))
  },
  billingCycle: args => billingCycle(asRecord(args).priced),
  includedUnits: args => {
    const rec = asRecord(args)
    return includedUnits(rec.priced, optionalString(rec.meter))
  },
  creditsPerUnitFromBalance: args => {
    const rec = asRecord(args)
    return creditsPerUnitFromBalance(rec.priced, rec.balance, optionalString(rec.meter))
  },
  charges: args => charges(asRecord(args).priced),
  trialDays: args => trialDays(asRecord(args).priced),
  peggedCreditsPerUnit: args => {
    const rec = asRecord(args)
    return peggedCreditsPerUnit(
      asNumber(rec.chargeMinor) ?? 0,
      asNumber(rec.creditsPerMinorUnit) ?? 0,
      asNumber(rec.usdToChargeRate) ?? null,
    )
  },
})
}

installPortableCoreFallbacks()
