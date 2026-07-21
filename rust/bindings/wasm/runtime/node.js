/**
 * Node runtime wrapper for the edge WASM profile.
 * Loads bytes via fs and initializes once.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import init, {
  wasmVersion as wasmVersionRaw,
  verifyWebhook as verifyWebhookRaw,
} from '../pkg/edge/solvapay_wasm.js'

let initPromise

function wasmPath() {
  return fileURLToPath(new URL('../pkg/edge/solvapay_wasm_bg.wasm', import.meta.url))
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

export function verifyWebhook(body, signature, secret, nowUnixSecs) {
  return verifyWebhookRaw(body, signature, secret, nowUnixSecs)
}
