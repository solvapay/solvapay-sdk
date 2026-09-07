/**
 * Browser profile of `@solvapay/server-wasm` — public-safe pure logic only.
 *
 * No webhook / transport-client / MCP / secret-adjacent exports (§7.8). Call
 * {@link ready} once to warm the module before the sync envelope functions, or
 * {@link ensureReadySync} with a precompiled module for the sync path.
 */

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
  resolveBuyerCountry,
  getCustomerAddressFieldErrors,
  isCustomerAddressComplete,
  isPostalCodeRequired,
  isStateRequired,
  getStateFieldLabel,
  getPostalCodeFieldLabel,
  getPostalCodePlaceholder,
  POSTAL_CODE_REQUIRED_COUNTRIES,
  STATE_REQUIRED_COUNTRIES,
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
  countsUsage,
  meterName,
  usageRate,
  peggedCreditsPerUnit,
  creditsPerUnitFromBalance,
  planPricingShape,
  resolveAccountState,
  deriveDefaultView,
  resolvePlanShape,
  planConsequence,
  deriveActiveProducts,
  historyRows,
  formatCompactCredits,
  resolveDisplayMode,
  formatPrice,
  formatSubtotalLabel,
  formatVatSummaryLabel,
  resolveTaxTreatmentNote,
  shouldShowTaxRow,
  toMajorUnits,
  REVERSE_CHARGE_NOTE,
  TAX_NOT_COLLECTED_NOTE,
} from '../pkg/browser/solvapay_wasm'

/**
 * Instantiates from inlined WASM bytes. Pass a `BufferSource` straight
 * through to wasm-bindgen — no fetch, no `data:` URL.
 */
export function readyFromBytes(bytes: BufferSource): Promise<void>

/**
 * Resolves when the browser WASM module has been instantiated (async).
 * When `source` is omitted, fetches the sibling `.wasm` URL.
 */
export function ready(source?: BufferSource): Promise<void>

/**
 * Synchronously instantiates from an already-compiled `WebAssembly.Module`.
 * Throws if called without a module before {@link ready} has warmed the module.
 */
export function ensureReadySync(wasmModule?: WebAssembly.Module): void
