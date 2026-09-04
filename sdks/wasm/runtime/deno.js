/**
 * Deno runtime wrapper for the edge WASM profile.
 * Uses URL-based async init (wasm-bindgen --target web); sync
 * {@link ensureReadySync} reads bytes via `Deno.readFileSync`. Re-exports the
 * full generated edge surface (`WasmClient`, `verifyWebhook`, `wasmVersion`,
 * and every sync envelope fn).
 */
import init, { initSync } from '../pkg/edge/solvapay_wasm.js'

export * from '../pkg/edge/solvapay_wasm.js'

let initPromise
let syncInitDone = false

function wasmUrl() {
  return new URL('../pkg/edge/solvapay_wasm_bg.wasm', import.meta.url)
}

export function ready() {
  if (!initPromise) {
    initPromise = init({ module_or_path: wasmUrl() }).then(() => {
      syncInitDone = true
      return undefined
    })
  }
  return initPromise
}

export function ensureReadySync() {
  if (syncInitDone) return
  initSync({ module: Deno.readFileSync(wasmUrl()) })
  syncInitDone = true
}
