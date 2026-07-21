/**
 * Deno runtime wrapper for the edge WASM profile.
 * Uses URL-based async init (wasm-bindgen --target web).
 */
import init, {
  wasmVersion as wasmVersionRaw,
  verifyWebhook as verifyWebhookRaw,
} from '../pkg/edge/solvapay_wasm.js'

let initPromise

export function ready() {
  if (!initPromise) {
    initPromise = init({
      module_or_path: new URL('../pkg/edge/solvapay_wasm_bg.wasm', import.meta.url),
    }).then(() => undefined)
  }
  return initPromise
}

export function wasmVersion() {
  return wasmVersionRaw()
}

export function verifyWebhook(body, signature, secret, nowUnixSecs) {
  return verifyWebhookRaw(body, signature, secret, nowUnixSecs)
}
