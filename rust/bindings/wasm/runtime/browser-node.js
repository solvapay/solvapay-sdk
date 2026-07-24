/**
 * Node-only loader for the browser WASM profile (Vitest / measure scripts).
 * Uses fs instead of fetch(file://), which Node does not implement.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import init, { wasmVersion as wasmVersionRaw } from '../pkg/browser/solvapay_wasm.js'

let initPromise

function wasmPath() {
  return fileURLToPath(new URL('../pkg/browser/solvapay_wasm_bg.wasm', import.meta.url))
}

export function ready() {
  if (!initPromise) {
    initPromise = init({ module_or_path: readFileSync(wasmPath()) }).then(() => undefined)
  }
  return initPromise
}

export function wasmVersion() {
  return wasmVersionRaw()
}
