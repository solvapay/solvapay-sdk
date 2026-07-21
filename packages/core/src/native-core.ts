/**
 * Sync core pure-logic delegation layer (Step 37R-d).
 *
 * `business-details` / `credit-display` / `seller-identity` dispatch to napi
 * via an *installed* API so this module never statically imports
 * `node:module` or `@solvapay/server-native` — keeping React/browser graphs safe.
 *
 * Node (`@solvapay/server` index) and vitest setup call `installNativeCoreApi`.
 * Browser / React never installs → always TypeScript fallback.
 */

import {
  BUSINESS_COUNTRY_OPTIONS,
  deriveTaxIdType as deriveTaxIdTypeTs,
  getTaxIdExample as getTaxIdExampleTs,
  getTaxIdFieldLabel as getTaxIdFieldLabelTs,
  getTaxIdHelperText as getTaxIdHelperTextTs,
  resolveTaxBehavior as resolveTaxBehaviorTs,
  validateBusinessDetails as validateBusinessDetailsTs,
  type BusinessCountryOption,
  type BusinessDetailsInput,
  type SupportedBusinessCountry,
  type TaxBehavior,
  type TaxIdType,
  type ValidateBusinessDetailsResult,
} from './business-details'
import {
  creditsToDisplayMinorUnits as creditsToDisplayMinorUnitsTs,
  isZeroDecimalCurrency as isZeroDecimalCurrencyTs,
  minorUnitsPerMajor as minorUnitsPerMajorTs,
} from './credit-display'
import {
  SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE as SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE_TS,
  getSellerTaxIdentifierDisplayLabel as getSellerTaxIdentifierDisplayLabelTs,
  resolveSellerIdentityDisplay as resolveSellerIdentityDisplayTs,
  type SellerIdentityDisplay,
} from './seller-identity'

export type SolvaPayImpl = 'ts' | 'rust'

export type NativeCoreSyncMethod =
  | 'validateBusinessDetails'
  | 'deriveTaxIdType'
  | 'resolveTaxBehavior'
  | 'getTaxIdExample'
  | 'getTaxIdFieldLabel'
  | 'getTaxIdHelperText'
  | 'getBusinessCountryOptions'
  | 'creditsToDisplayMinorUnits'
  | 'isZeroDecimalCurrency'
  | 'minorUnitsPerMajor'
  | 'resolveSellerIdentityDisplay'
  | 'getSellerTaxIdentifierDisplayLabel'
  | 'SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE'

type NativeCoreApi = {
  callNativeSync: (fn: NativeCoreSyncMethod, argsJson: string) => unknown
  resolveImpl: (surface: string) => SolvaPayImpl
}

let installed: NativeCoreApi | null = null

export function installNativeCoreApi(api: NativeCoreApi): void {
  installed = api
}

/** @internal test helper */
export function resetNativeCoreApiForTests(): void {
  installed = null
}

function shouldAttemptNative(): boolean {
  try {
    return (
      typeof process !== 'undefined' &&
      typeof process.versions === 'object' &&
      process.versions != null &&
      typeof process.versions.node === 'string' &&
      process.env.SOLVAPAY_IMPL !== 'ts'
    )
  } catch {
    return false
  }
}

function dispatchSync<T>(fn: NativeCoreSyncMethod, args: unknown, tsFallback: () => T): T {
  if (!shouldAttemptNative() || installed === null) return tsFallback()
  if (installed.resolveImpl('helper') !== 'rust') return tsFallback()
  return installed.callNativeSync(fn, JSON.stringify(args)) as T
}

// --- business-details ---

export function validateBusinessDetails(
  input: BusinessDetailsInput,
): ValidateBusinessDetailsResult {
  return dispatchSync('validateBusinessDetails', input, () => validateBusinessDetailsTs(input))
}

export function deriveTaxIdType(country: SupportedBusinessCountry): TaxIdType {
  return dispatchSync('deriveTaxIdType', { country }, () => deriveTaxIdTypeTs(country))
}

export function resolveTaxBehavior(
  behavior: TaxBehavior,
  currency: string,
): 'inclusive' | 'exclusive' {
  return dispatchSync(
    'resolveTaxBehavior',
    { behavior, currency },
    () => resolveTaxBehaviorTs(behavior, currency),
  )
}

export function getTaxIdExample(country: SupportedBusinessCountry): string {
  return dispatchSync('getTaxIdExample', { country }, () => getTaxIdExampleTs(country))
}

export function getTaxIdFieldLabel(country: SupportedBusinessCountry): string {
  return dispatchSync('getTaxIdFieldLabel', { country }, () => getTaxIdFieldLabelTs(country))
}

export function getTaxIdHelperText(country: SupportedBusinessCountry): string {
  return dispatchSync('getTaxIdHelperText', { country }, () => getTaxIdHelperTextTs(country))
}

/** Fixture-visible accessor; `BUSINESS_COUNTRY_OPTIONS` const stays for types/React. */
export function getBusinessCountryOptions(): BusinessCountryOption[] {
  return dispatchSync('getBusinessCountryOptions', {}, () => BUSINESS_COUNTRY_OPTIONS)
}

// --- credit-display ---

export function minorUnitsPerMajor(currency: string): number {
  return dispatchSync('minorUnitsPerMajor', { currency }, () => minorUnitsPerMajorTs(currency))
}

export function isZeroDecimalCurrency(currency: string): boolean {
  return dispatchSync(
    'isZeroDecimalCurrency',
    { currency },
    () => isZeroDecimalCurrencyTs(currency),
  )
}

export function creditsToDisplayMinorUnits(input: {
  credits: number
  creditsPerMinorUnit: number
  displayExchangeRate: number
  displayCurrency: string
}): number | null {
  return dispatchSync('creditsToDisplayMinorUnits', input, () =>
    creditsToDisplayMinorUnitsTs(input),
  )
}

// --- seller-identity ---

/** Fixture-visible accessor; const export keeps `as const` identity for types. */
export function getSellerTaxIdentifierDisplayLabelByType(): Record<TaxIdType, string> {
  return dispatchSync(
    'SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE',
    {},
    () => SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE_TS,
  )
}

export function getSellerTaxIdentifierDisplayLabel(country: string | null | undefined): string {
  return dispatchSync(
    'getSellerTaxIdentifierDisplayLabel',
    { country: country ?? null },
    () => getSellerTaxIdentifierDisplayLabelTs(country),
  )
}

export function resolveSellerIdentityDisplay(input: {
  country?: string | null
  vatNumber?: string | null
  taxId?: string | null
  companyNumber?: string | null
}): SellerIdentityDisplay {
  return dispatchSync(
    'resolveSellerIdentityDisplay',
    {
      country: input.country ?? null,
      vatNumber: input.vatNumber ?? null,
      taxId: input.taxId ?? null,
      companyNumber: input.companyNumber ?? null,
    },
    () => resolveSellerIdentityDisplayTs(input),
  )
}
