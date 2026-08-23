/**
 * Backwards-compatible shim for the narrow Step 38 webhook cutover.
 *
 * The edge WASM adapter now lives in `./wasm` (Step 38R full-surface cutover).
 * This module re-exports the webhook-specific names under their original
 * identifiers so existing imports keep working. Prefer importing from `./wasm`.
 */

import {
  type WasmBinding,
  resetWasmCache,
  setWasmBindingForTests,
  verifyWebhookWasm,
} from './wasm'

export { verifyWebhookWasm }

/**
 * Clears cached WASM init state. Used by unit tests.
 * @internal
 */
export function resetWasmWebhookCache(): void {
  resetWasmCache()
}

/**
 * Injects a fake WASM binding for unit tests.
 * @internal
 */
export function setWasmWebhookBindingForTests(binding: WasmBinding | null): void {
  setWasmBindingForTests(binding)
}
