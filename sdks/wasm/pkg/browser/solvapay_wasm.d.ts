/* tslint:disable */
/* eslint-disable */

/**
 * Binding for `POSTAL_CODE_REQUIRED_COUNTRIES`.
 */
export function POSTAL_CODE_REQUIRED_COUNTRIES(args_json: string): string;

/**
 * Binding for `REVERSE_CHARGE_NOTE`.
 */
export function REVERSE_CHARGE_NOTE(args_json: string): string;

/**
 * Binding for `SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE`.
 */
export function SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE(args_json: string): string;

/**
 * Binding for `STATE_REQUIRED_COUNTRIES`.
 */
export function STATE_REQUIRED_COUNTRIES(args_json: string): string;

/**
 * Binding for `TAX_NOT_COLLECTED_NOTE`.
 */
export function TAX_NOT_COLLECTED_NOTE(args_json: string): string;

/**
 * Binding for `billingCycle`.
 */
export function billingCycle(args_json: string): string;

/**
 * Binding for `charges`.
 */
export function charges(args_json: string): string;

/**
 * Binding for `countsUsage`.
 */
export function countsUsage(args_json: string): string;

/**
 * Binding for `creditsPerUnitFromBalance`.
 */
export function creditsPerUnitFromBalance(args_json: string): string;

/**
 * Binding for `creditsToDisplayMinorUnits` (`null` when undefined).
 */
export function creditsToDisplayMinorUnits(args_json: string): string;

/**
 * Binding for `deriveActiveProducts`.
 */
export function deriveActiveProducts(args_json: string): string;

/**
 * Binding for `deriveDefaultView`.
 */
export function deriveDefaultView(args_json: string): string;

/**
 * Binding for `deriveTaxIdType`.
 */
export function deriveTaxIdType(args_json: string): string;

/**
 * Binding for `formatCompactCredits`.
 */
export function formatCompactCredits(args_json: string): string;

/**
 * Binding for `formatPrice`.
 */
export function formatPrice(args_json: string): string;

/**
 * Binding for `formatSubtotalLabel`.
 */
export function formatSubtotalLabel(args_json: string): string;

/**
 * Binding for `formatVatSummaryLabel`.
 */
export function formatVatSummaryLabel(args_json: string): string;

/**
 * Binding for `getBusinessCountryOptions`.
 */
export function getBusinessCountryOptions(args_json: string): string;

/**
 * Binding for `getCustomerAddressFieldErrors`.
 */
export function getCustomerAddressFieldErrors(args_json: string): string;

/**
 * Binding for `getPostalCodeFieldLabel`.
 */
export function getPostalCodeFieldLabel(args_json: string): string;

/**
 * Binding for `getPostalCodePlaceholder`.
 */
export function getPostalCodePlaceholder(args_json: string): string;

/**
 * Binding for `getSellerTaxIdentifierDisplayLabel`.
 */
export function getSellerTaxIdentifierDisplayLabel(args_json: string): string;

/**
 * Binding for `getStateFieldLabel`.
 */
export function getStateFieldLabel(args_json: string): string;

/**
 * Binding for `getTaxIdExample`.
 */
export function getTaxIdExample(args_json: string): string;

/**
 * Binding for `getTaxIdFieldLabel`.
 */
export function getTaxIdFieldLabel(args_json: string): string;

/**
 * Binding for `getTaxIdHelperText`.
 */
export function getTaxIdHelperText(args_json: string): string;

/**
 * Binding for `headlineCharges`.
 */
export function headlineCharges(args_json: string): string;

/**
 * Binding for `historyRows`.
 */
export function historyRows(args_json: string): string;

/**
 * Binding for `includedUnits`.
 */
export function includedUnits(args_json: string): string;

/**
 * Binding for `isCustomerAddressComplete`.
 */
export function isCustomerAddressComplete(args_json: string): string;

/**
 * Binding for `isPostalCodeRequired`.
 */
export function isPostalCodeRequired(args_json: string): string;

/**
 * Binding for `isStateRequired`.
 */
export function isStateRequired(args_json: string): string;

/**
 * Binding for `isUnlimitedRemaining`.
 */
export function isUnlimitedRemaining(args_json: string): string;

/**
 * Binding for `isZeroDecimalCurrency`.
 */
export function isZeroDecimalCurrency(args_json: string): string;

/**
 * Binding for `meterName`.
 */
export function meterName(args_json: string): string;

/**
 * Binding for `minorUnitsPerMajor`.
 */
export function minorUnitsPerMajor(args_json: string): string;

/**
 * Binding for `peggedCreditsPerUnit`.
 */
export function peggedCreditsPerUnit(args_json: string): string;

/**
 * Binding for `perUnitCharge`.
 */
export function perUnitCharge(args_json: string): string;

/**
 * Binding for `planConsequence`.
 */
export function planConsequence(args_json: string): string;

/**
 * Binding for `planPricingShape`.
 */
export function planPricingShape(args_json: string): string;

/**
 * Binding for `resolveAccountState`.
 */
export function resolveAccountState(args_json: string): string;

/**
 * Binding for `resolveBuyerCountry`.
 */
export function resolveBuyerCountry(args_json: string): string;

/**
 * Binding for `resolveDisplayMode`.
 */
export function resolveDisplayMode(args_json: string): string;

/**
 * Binding for `resolvePlanShape`.
 */
export function resolvePlanShape(args_json: string): string;

/**
 * Binding for `resolveSellerIdentityDisplay`.
 */
export function resolveSellerIdentityDisplay(args_json: string): string;

/**
 * Binding for `resolveTaxBehavior`.
 */
export function resolveTaxBehavior(args_json: string): string;

/**
 * Binding for `resolveTaxTreatmentNote`.
 */
export function resolveTaxTreatmentNote(args_json: string): string;

/**
 * Binding for `shouldShowTaxRow`.
 */
export function shouldShowTaxRow(args_json: string): string;

/**
 * Binding for `toMajorUnits`.
 */
export function toMajorUnits(args_json: string): string;

/**
 * Binding for `trialDays`.
 */
export function trialDays(args_json: string): string;

/**
 * Binding for `usageRate`.
 */
export function usageRate(args_json: string): string;

/**
 * Binding for `validateBusinessDetails`.
 */
export function validateBusinessDetails(args_json: string): string;

/**
 * Returns `{version, coreSha}` JSON for §7.7 version stamping diagnostics.
 *
 * Available on both `edge` and `browser` profiles.
 */
export function wasmBuildInfo(): string;

/**
 * Returns the crate version string (`CARGO_PKG_VERSION`).
 *
 * Used as a hello-world smoke export proving the WASM module loads under both
 * edge and browser profiles.
 */
export function wasmVersion(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly POSTAL_CODE_REQUIRED_COUNTRIES: (a: number, b: number) => [number, number];
    readonly REVERSE_CHARGE_NOTE: (a: number, b: number) => [number, number];
    readonly SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE: (a: number, b: number) => [number, number];
    readonly STATE_REQUIRED_COUNTRIES: (a: number, b: number) => [number, number];
    readonly TAX_NOT_COLLECTED_NOTE: (a: number, b: number) => [number, number];
    readonly billingCycle: (a: number, b: number) => [number, number];
    readonly charges: (a: number, b: number) => [number, number];
    readonly countsUsage: (a: number, b: number) => [number, number];
    readonly creditsPerUnitFromBalance: (a: number, b: number) => [number, number];
    readonly creditsToDisplayMinorUnits: (a: number, b: number) => [number, number];
    readonly deriveActiveProducts: (a: number, b: number) => [number, number];
    readonly deriveDefaultView: (a: number, b: number) => [number, number];
    readonly deriveTaxIdType: (a: number, b: number) => [number, number];
    readonly formatCompactCredits: (a: number, b: number) => [number, number];
    readonly formatPrice: (a: number, b: number) => [number, number];
    readonly formatSubtotalLabel: (a: number, b: number) => [number, number];
    readonly formatVatSummaryLabel: (a: number, b: number) => [number, number];
    readonly getBusinessCountryOptions: (a: number, b: number) => [number, number];
    readonly getCustomerAddressFieldErrors: (a: number, b: number) => [number, number];
    readonly getPostalCodeFieldLabel: (a: number, b: number) => [number, number];
    readonly getPostalCodePlaceholder: (a: number, b: number) => [number, number];
    readonly getSellerTaxIdentifierDisplayLabel: (a: number, b: number) => [number, number];
    readonly getStateFieldLabel: (a: number, b: number) => [number, number];
    readonly getTaxIdExample: (a: number, b: number) => [number, number];
    readonly getTaxIdFieldLabel: (a: number, b: number) => [number, number];
    readonly getTaxIdHelperText: (a: number, b: number) => [number, number];
    readonly headlineCharges: (a: number, b: number) => [number, number];
    readonly historyRows: (a: number, b: number) => [number, number];
    readonly includedUnits: (a: number, b: number) => [number, number];
    readonly isCustomerAddressComplete: (a: number, b: number) => [number, number];
    readonly isPostalCodeRequired: (a: number, b: number) => [number, number];
    readonly isStateRequired: (a: number, b: number) => [number, number];
    readonly isUnlimitedRemaining: (a: number, b: number) => [number, number];
    readonly isZeroDecimalCurrency: (a: number, b: number) => [number, number];
    readonly meterName: (a: number, b: number) => [number, number];
    readonly minorUnitsPerMajor: (a: number, b: number) => [number, number];
    readonly peggedCreditsPerUnit: (a: number, b: number) => [number, number];
    readonly perUnitCharge: (a: number, b: number) => [number, number];
    readonly planConsequence: (a: number, b: number) => [number, number];
    readonly planPricingShape: (a: number, b: number) => [number, number];
    readonly resolveAccountState: (a: number, b: number) => [number, number];
    readonly resolveBuyerCountry: (a: number, b: number) => [number, number];
    readonly resolveDisplayMode: (a: number, b: number) => [number, number];
    readonly resolvePlanShape: (a: number, b: number) => [number, number];
    readonly resolveSellerIdentityDisplay: (a: number, b: number) => [number, number];
    readonly resolveTaxBehavior: (a: number, b: number) => [number, number];
    readonly resolveTaxTreatmentNote: (a: number, b: number) => [number, number];
    readonly shouldShowTaxRow: (a: number, b: number) => [number, number];
    readonly toMajorUnits: (a: number, b: number) => [number, number];
    readonly trialDays: (a: number, b: number) => [number, number];
    readonly usageRate: (a: number, b: number) => [number, number];
    readonly validateBusinessDetails: (a: number, b: number) => [number, number];
    readonly wasmBuildInfo: () => [number, number];
    readonly wasmVersion: () => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
