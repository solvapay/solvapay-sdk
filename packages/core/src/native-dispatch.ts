/**
 * Shared install-gated sync dispatch for `@solvapay/core` (Step 52).
 *
 * Node (`@solvapay/server`) and vitest setup call {@link installNativeCoreApi}.
 * Browser installs via eager `@solvapay/core/browser-wasm`. When uninstalled
 * (or `SOLVAPAY_IMPL=ts`), sync APIs throw — there is no portable TS fallback.
 */

import { SolvaPayError } from './solvapay-error'

export type SolvaPayImpl = 'ts' | 'rust'

export type NativeCoreSyncMethod =
  // Domain (37R-d)
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
  // Helpers (Phase 4/5 → Step 52)
  | 'classifyCustomerRef'
  | 'coerceCustomerOptions'
  | 'buildCreateCustomerParams'
  | 'extractBackendCustomerRef'
  | 'classifyLookupError'
  | 'classifyCreateError'
  | 'isEmailConflict'
  | 'validateActivatePlanParams'
  | 'validateCreatePaymentIntentParams'
  | 'validateTopupPaymentIntentParams'
  | 'validateProcessPaymentIntentParams'
  | 'validateAttachBusinessDetailsParams'
  | 'attachBusinessDetailsValidationError'
  | 'projectPaymentIntentResult'
  | 'projectTopupProcessOutcome'
  | 'resolveReturnUrl'
  | 'validateCheckoutSessionParams'
  | 'isCachedCustomerRefValid'
  | 'resolvePurchaseCustomerRef'
  | 'selectActivePurchases'
  | 'classifyCancelError'
  | 'classifyReactivateError'
  | 'normalizeCancelResponse'
  | 'normalizeReactivateResponse'
  | 'validatePurchaseRef'
  | 'projectUsageSnapshot'
  | 'resolveCheckLimitsParams'
  | 'validateListPlansParams'
  | 'isErrorResult'
  | 'mapRouteError'
  | 'validateGetProductParams'
  | 'resolveProductRef'
  | 'evaluateCachedLimits'
  | 'evaluateFreshLimits'
  | 'decidePaywallOutcome'
  | 'resolveFallbackGateLimits'

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

/**
 * Dispatches a sync core/helper method to the installed binding.
 * Throws when the API is not installed or `SOLVAPAY_IMPL` forces TypeScript
 * (Rust-only after Step 52 — no portable TS fallback).
 */
export function dispatchSync<T>(fn: NativeCoreSyncMethod, args: unknown): T {
  if (installed === null || installed.resolveImpl('helper') !== 'rust') {
    throw new SolvaPayError('core sync API not installed')
  }
  return installed.callNativeSync(fn, JSON.stringify(args)) as T
}
