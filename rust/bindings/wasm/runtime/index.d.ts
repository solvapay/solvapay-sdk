/**
 * Edge profile of `@solvapay/server-wasm`.
 *
 * Call {@link ready} once (or await it before each use — it is idempotent)
 * before invoking any export. On runtimes with synchronous module access
 * (Node, workerd, Deno) {@link ensureReadySync} instantiates the module
 * synchronously for the sync envelope functions; on generic edge-light hosts
 * it is absent and callers must warm up via {@link ready} first.
 *
 * Re-exports the full generated edge surface: `WasmClient`, `verifyWebhook`,
 * `wasmVersion`, `initSync`, and every sync envelope function.
 */

export * from '../pkg/edge/solvapay_wasm'

/** Resolves when the edge WASM module has been instantiated (async). */
export function ready(): Promise<void>

/**
 * Synchronously instantiates the module so sync envelope functions can run.
 * Present on Node / workerd / Deno; absent on generic edge-light hosts (warm up
 * via {@link ready} there instead).
 */
export function ensureReadySync(): void
