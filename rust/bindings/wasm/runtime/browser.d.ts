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
  validateBusinessDetails,
  deriveTaxIdType,
  resolveTaxBehavior,
  getTaxIdExample,
  getTaxIdFieldLabel,
  getTaxIdHelperText,
  getBusinessCountryOptions,
  creditsToDisplayMinorUnits,
  isZeroDecimalCurrency,
  minorUnitsPerMajor,
  resolveSellerIdentityDisplay,
  getSellerTaxIdentifierDisplayLabel,
  SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE,
} from '../pkg/browser/solvapay_wasm'

/** Resolves when the browser WASM module has been instantiated (async). */
export function ready(): Promise<void>

/**
 * Synchronously instantiates from an already-compiled `WebAssembly.Module`.
 * Throws if called without a module before {@link ready} has warmed the module.
 */
export function ensureReadySync(wasmModule?: WebAssembly.Module): void
