/**
 * Browser profile wrapper — wasmVersion only (no webhook export).
 */
import init, { wasmVersion as wasmVersionRaw } from '../pkg/browser/solvapay_wasm.js'

let initPromise

export function ready() {
  if (!initPromise) {
    initPromise = init({
      module_or_path: new URL('../pkg/browser/solvapay_wasm_bg.wasm', import.meta.url),
    }).then(() => undefined)
  }
  return initPromise
}

export function wasmVersion() {
  return wasmVersionRaw()
}
