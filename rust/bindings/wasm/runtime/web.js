/**
 * Default web / edge-light wrapper for the edge WASM profile.
 *
 * No synchronous file access is available here, so there is no
 * `ensureReadySync`: callers must `await ready()` (warm-up) before any sync
 * envelope function. Re-exports the full generated edge surface (`WasmClient`,
 * `verifyWebhook`, `wasmVersion`, and every sync envelope fn).
 */
import init from '../pkg/edge/solvapay_wasm.js'

export * from '../pkg/edge/solvapay_wasm.js'

let initPromise

export function ready() {
  if (!initPromise) {
    initPromise = init({
      module_or_path: new URL('../pkg/edge/solvapay_wasm_bg.wasm', import.meta.url),
    }).then(() => undefined)
  }
  return initPromise
}
