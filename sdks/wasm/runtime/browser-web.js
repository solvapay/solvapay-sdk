/**
 * Browser profile wrapper — public-safe pure logic only.
 *
 * Exposes `wasmVersion` plus the business-details / credit-display /
 * seller-identity / plan-pricing sync envelope functions (§7.8 public-safe
 * subset). Never exports webhook verification, the transport `WasmClient`,
 * or any MCP / secret-adjacent server symbol — those are compiled out of
 * the browser Rust profile. Exports are enumerated explicitly (not
 * `export *`) so the browser symbol audit can verify the exact surface.
 * `ready()` warms the module asynchronously; `ensureReadySync()` instantiates
 * from a precompiled `WebAssembly.Module` when the caller already has one.
 */
import init, {
  initSync,
  wasmVersion,
  wasmBuildInfo,
  // business-details (public-safe)
  validateBusinessDetails,
  deriveTaxIdType,
  resolveTaxBehavior,
  getTaxIdExample,
  getTaxIdFieldLabel,
  getTaxIdHelperText,
  getBusinessCountryOptions,
  // credit-display (public-safe)
  creditsToDisplayMinorUnits,
  isZeroDecimalCurrency,
  isUnlimitedRemaining,
  minorUnitsPerMajor,
  // seller-identity (public-safe)
  resolveSellerIdentityDisplay,
  getSellerTaxIdentifierDisplayLabel,
  SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE,
  // plan-pricing (public-safe)
  charges,
  headlineCharges,
  perUnitCharge,
  billingCycle,
  trialDays,
  includedUnits,
  peggedCreditsPerUnit,
  creditsPerUnitFromBalance,
  formatPrice,
  formatSubtotalLabel,
  formatVatSummaryLabel,
  resolveTaxTreatmentNote,
  shouldShowTaxRow,
  toMajorUnits,
  REVERSE_CHARGE_NOTE,
  TAX_NOT_COLLECTED_NOTE,
} from '../pkg/browser/solvapay_wasm.js'

export {
  initSync,
  wasmVersion,
  wasmBuildInfo,
  validateBusinessDetails,
  deriveTaxIdType,
  resolveTaxBehavior,
  getTaxIdExample,
  getTaxIdFieldLabel,
  getTaxIdHelperText,
  getBusinessCountryOptions,
  creditsToDisplayMinorUnits,
  isZeroDecimalCurrency,
  isUnlimitedRemaining,
  minorUnitsPerMajor,
  resolveSellerIdentityDisplay,
  getSellerTaxIdentifierDisplayLabel,
  SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE,
  charges,
  headlineCharges,
  perUnitCharge,
  billingCycle,
  trialDays,
  includedUnits,
  peggedCreditsPerUnit,
  creditsPerUnitFromBalance,
  formatPrice,
  formatSubtotalLabel,
  formatVatSummaryLabel,
  resolveTaxTreatmentNote,
  shouldShowTaxRow,
  toMajorUnits,
  REVERSE_CHARGE_NOTE,
  TAX_NOT_COLLECTED_NOTE,
}

let initPromise
let syncInitDone = false

export function ready() {
  if (!initPromise) {
    initPromise = init({
      module_or_path: new URL('../pkg/browser/solvapay_wasm_bg.wasm', import.meta.url),
    }).then(() => {
      syncInitDone = true
      return undefined
    })
  }
  return initPromise
}

/**
 * Synchronously instantiates from an already-compiled `WebAssembly.Module`.
 * Browsers have no synchronous byte access, so callers that need the sync path
 * must pass a module they compiled/streamed themselves; otherwise use
 * {@link ready} to warm asynchronously first.
 */
export function ensureReadySync(wasmModule) {
  if (syncInitDone) return
  if (wasmModule === undefined) {
    throw new Error(
      '@solvapay/server-wasm/browser: ensureReadySync() needs a WebAssembly.Module; await ready() to warm asynchronously instead',
    )
  }
  initSync({ module: wasmModule })
  syncInitDone = true
}
