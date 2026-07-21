/**
 * Browser profile of `@solvapay/server-wasm` — no webhook / secret-key exports.
 */

/** Resolves when the browser WASM module has been instantiated. */
export function ready(): Promise<void>

/** Returns the binding crate version string. */
export function wasmVersion(): string
