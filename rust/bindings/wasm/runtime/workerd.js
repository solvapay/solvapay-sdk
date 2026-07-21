/**
 * workerd / Cloudflare Workers wrapper for the edge WASM profile.
 * A `.wasm` import resolves to a `WebAssembly.Module`.
 */
import wasmModule from '../pkg/edge/solvapay_wasm_bg.wasm'
import {
  wasmVersion as wasmVersionRaw,
  verifyWebhook as verifyWebhookRaw,
  initSync,
} from '../pkg/edge/solvapay_wasm.js'

let initPromise

export function ready() {
  if (!initPromise) {
    initPromise = Promise.resolve().then(() => {
      initSync({ module: wasmModule })
    })
  }
  return initPromise
}

export function wasmVersion() {
  return wasmVersionRaw()
}

export function verifyWebhook(body, signature, secret, nowUnixSecs) {
  return verifyWebhookRaw(body, signature, secret, nowUnixSecs)
}
