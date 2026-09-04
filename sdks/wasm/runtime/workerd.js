/**
 * workerd / Cloudflare Workers wrapper for the edge WASM profile.
 * A `.wasm` import resolves to a `WebAssembly.Module`, so both async
 * {@link ready} and sync {@link ensureReadySync} use `initSync`. Re-exports the
 * full generated edge surface (`WasmClient`, `verifyWebhook`, `wasmVersion`,
 * and every sync envelope fn).
 */
import wasmModule from '../pkg/edge/solvapay_wasm_bg.wasm'
import { initSync } from '../pkg/edge/solvapay_wasm.js'

export * from '../pkg/edge/solvapay_wasm.js'

let initPromise
let syncInitDone = false

export function ready() {
  if (!initPromise) {
    initPromise = Promise.resolve().then(() => {
      initSync({ module: wasmModule })
      syncInitDone = true
    })
  }
  return initPromise
}

export function ensureReadySync() {
  if (syncInitDone) return
  initSync({ module: wasmModule })
  syncInitDone = true
}
