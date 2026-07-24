/**
 * Node runtime wrapper for the edge WASM profile.
 * Loads bytes via fs and initializes once (async {@link ready} or sync
 * {@link ensureReadySync}). Re-exports the full generated edge surface
 * (`WasmClient`, `verifyWebhook`, `wasmVersion`, and every sync envelope fn).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import init, { initSync } from '../pkg/edge/solvapay_wasm.js'

export * from '../pkg/edge/solvapay_wasm.js'

let initPromise
let syncInitDone = false

function wasmBytes() {
  return readFileSync(fileURLToPath(new URL('../pkg/edge/solvapay_wasm_bg.wasm', import.meta.url)))
}

export function ready() {
  if (!initPromise) {
    initPromise = init({ module_or_path: wasmBytes() }).then(() => {
      syncInitDone = true
      return undefined
    })
  }
  return initPromise
}

export function ensureReadySync() {
  if (syncInitDone) return
  initSync({ module: wasmBytes() })
  syncInitDone = true
}
