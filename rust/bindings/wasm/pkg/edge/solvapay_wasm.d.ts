/* tslint:disable */
/* eslint-disable */

/**
 * Verifies a SolvaPay webhook signature with an explicit clock.
 *
 * Returns the parsed JSON body as a string on success. On failure throws a JS
 * `Error` whose `code` is the snake_case webhook error code.
 *
 * # Arguments
 *
 * * `body` - Raw request body string.
 * * `signature` - `SV-Signature` header value.
 * * `secret` - Webhook secret (`whsec_…`).
 * * `now_unix_secs` - Host clock as unix seconds (typically `Math.floor(Date.now()/1000)`).
 *   Accepted as `f64` so the JS binding stays a Number (wasm-bindgen maps `i64` to BigInt).
 */
export function verifyWebhook(body: string, signature: string, secret: string, now_unix_secs: number): string;

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
    readonly verifyWebhook: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number, number];
    readonly wasmVersion: () => [number, number];
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
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
