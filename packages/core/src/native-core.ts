/**
 * Sync core pure-logic facade (Step 37R-d / Step 52).
 *
 * `business-details` / `credit-display` / `seller-identity` dispatch to napi
 * or browser WASM via an *installed* API so this module never statically
 * imports `node:module` or `@solvapay/server-native`.
 *
 * After Step 52 there is no TypeScript fallback — uninstalled or
 * `SOLVAPAY_IMPL=ts` throws {@link SolvaPayError}.
 */

import type {
  BusinessCountryOption,
  BusinessDetailsInput,
  SupportedBusinessCountry,
  TaxBehavior,
  TaxIdType,
  ValidateBusinessDetailsResult,
} from './business-details'
import type { SellerIdentityDisplay } from './seller-identity'
import {
  dispatchSync,
  installNativeCoreApi,
  resetNativeCoreApiForTests,
  type NativeCoreSyncMethod,
  type SolvaPayImpl,
} from './native-dispatch'

export type { NativeCoreSyncMethod, SolvaPayImpl }
export { installNativeCoreApi, resetNativeCoreApiForTests }

// --- business-details ---

export function validateBusinessDetails(
  input: BusinessDetailsInput,
): ValidateBusinessDetailsResult {
  return dispatchSync('validateBusinessDetails', input)
}

export function deriveTaxIdType(country: SupportedBusinessCountry): TaxIdType {
  return dispatchSync('deriveTaxIdType', { country })
}

export function resolveTaxBehavior(
  behavior: TaxBehavior,
  currency: string,
): 'inclusive' | 'exclusive' {
  return dispatchSync('resolveTaxBehavior', { behavior, currency })
}

export function getTaxIdExample(country: SupportedBusinessCountry): string {
  return dispatchSync('getTaxIdExample', { country })
}

export function getTaxIdFieldLabel(country: SupportedBusinessCountry): string {
  return dispatchSync('getTaxIdFieldLabel', { country })
}

export function getTaxIdHelperText(country: SupportedBusinessCountry): string {
  return dispatchSync('getTaxIdHelperText', { country })
}

/** Fixture-visible accessor; `BUSINESS_COUNTRY_OPTIONS` const stays for types/React. */
export function getBusinessCountryOptions(): BusinessCountryOption[] {
  return dispatchSync('getBusinessCountryOptions', {})
}

// --- credit-display ---

export function minorUnitsPerMajor(currency: string): number {
  return dispatchSync('minorUnitsPerMajor', { currency })
}

export function isZeroDecimalCurrency(currency: string): boolean {
  return dispatchSync('isZeroDecimalCurrency', { currency })
}

export function creditsToDisplayMinorUnits(input: {
  credits: number
  creditsPerMinorUnit: number
  displayExchangeRate: number
  displayCurrency: string
}): number | null {
  return dispatchSync('creditsToDisplayMinorUnits', input)
}

// --- seller-identity ---

/** Fixture-visible accessor; const export keeps `as const` identity for types. */
export function getSellerTaxIdentifierDisplayLabelByType(): Record<TaxIdType, string> {
  return dispatchSync('SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE', {})
}

export function getSellerTaxIdentifierDisplayLabel(country: string | null | undefined): string {
  return dispatchSync('getSellerTaxIdentifierDisplayLabel', { country: country ?? null })
}

export function resolveSellerIdentityDisplay(input: {
  country?: string | null
  vatNumber?: string | null
  taxId?: string | null
  companyNumber?: string | null
}): SellerIdentityDisplay {
  return dispatchSync('resolveSellerIdentityDisplay', {
    country: input.country ?? null,
    vatNumber: input.vatNumber ?? null,
    taxId: input.taxId ?? null,
    companyNumber: input.companyNumber ?? null,
  })
}
