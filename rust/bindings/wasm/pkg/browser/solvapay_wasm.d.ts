/* tslint:disable */
/* eslint-disable */

/**
 * Binding for `SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE`.
 */
export function SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE(args_json: string): string

/**
 * Binding for `creditsToDisplayMinorUnits` (`null` when undefined).
 */
export function creditsToDisplayMinorUnits(args_json: string): string

/**
 * Binding for `deriveTaxIdType`.
 */
export function deriveTaxIdType(args_json: string): string

/**
 * Binding for `getBusinessCountryOptions`.
 */
export function getBusinessCountryOptions(args_json: string): string

/**
 * Binding for `getSellerTaxIdentifierDisplayLabel`.
 */
export function getSellerTaxIdentifierDisplayLabel(args_json: string): string

/**
 * Binding for `getTaxIdExample`.
 */
export function getTaxIdExample(args_json: string): string

/**
 * Binding for `getTaxIdFieldLabel`.
 */
export function getTaxIdFieldLabel(args_json: string): string

/**
 * Binding for `getTaxIdHelperText`.
 */
export function getTaxIdHelperText(args_json: string): string

/**
 * Binding for `isZeroDecimalCurrency`.
 */
export function isZeroDecimalCurrency(args_json: string): string

/**
 * Binding for `minorUnitsPerMajor`.
 */
export function minorUnitsPerMajor(args_json: string): string

/**
 * Binding for `resolveSellerIdentityDisplay`.
 */
export function resolveSellerIdentityDisplay(args_json: string): string

/**
 * Binding for `resolveTaxBehavior`.
 */
export function resolveTaxBehavior(args_json: string): string

/**
 * Binding for `validateBusinessDetails`.
 */
export function validateBusinessDetails(args_json: string): string

/**
 * Returns the crate version string (`CARGO_PKG_VERSION`).
 *
 * Used as a hello-world smoke export proving the WASM module loads under both
 * edge and browser profiles.
 */
export function wasmVersion(): string

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module

export interface InitOutput {
  readonly memory: WebAssembly.Memory
  readonly SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE: (a: number, b: number) => [number, number]
  readonly creditsToDisplayMinorUnits: (a: number, b: number) => [number, number]
  readonly deriveTaxIdType: (a: number, b: number) => [number, number]
  readonly getBusinessCountryOptions: (a: number, b: number) => [number, number]
  readonly getSellerTaxIdentifierDisplayLabel: (a: number, b: number) => [number, number]
  readonly getTaxIdExample: (a: number, b: number) => [number, number]
  readonly getTaxIdFieldLabel: (a: number, b: number) => [number, number]
  readonly getTaxIdHelperText: (a: number, b: number) => [number, number]
  readonly isZeroDecimalCurrency: (a: number, b: number) => [number, number]
  readonly minorUnitsPerMajor: (a: number, b: number) => [number, number]
  readonly resolveSellerIdentityDisplay: (a: number, b: number) => [number, number]
  readonly resolveTaxBehavior: (a: number, b: number) => [number, number]
  readonly validateBusinessDetails: (a: number, b: number) => [number, number]
  readonly wasmVersion: () => [number, number]
  readonly __wbindgen_externrefs: WebAssembly.Table
  readonly __wbindgen_malloc: (a: number, b: number) => number
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number
  readonly __wbindgen_free: (a: number, b: number, c: number) => void
  readonly __wbindgen_start: () => void
}

export type SyncInitInput = BufferSource | WebAssembly.Module

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init(
  module_or_path?:
    | { module_or_path: InitInput | Promise<InitInput> }
    | InitInput
    | Promise<InitInput>,
): Promise<InitOutput>
