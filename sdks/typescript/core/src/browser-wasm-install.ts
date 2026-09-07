/**
 * Install `@solvapay/core` sync dispatch from the public-safe browser core.
 *
 * The MCP App widget calls {@link installBrowserCoreJs} with the wasm2js
 * binding before first render. The URL-warming WASM entry stays in
 * `browser-wasm.ts` for non-sandboxed browsers.
 */

import {
  installNativeCoreApi,
  resetNativeCoreApiForTests,
  type NativeCoreSyncMethod,
} from './native-core'
import { SolvaPayError } from './solvapay-error'

/** Async ready + the public-safe sync envelope functions on the browser binding. */
export type BrowserBinding = {
  ready: (source?: BufferSource) => Promise<void>
  readyFromBytes?: (bytes: BufferSource) => Promise<void>
  ensureReadySync?: (wasmModule?: WebAssembly.Module) => void
} & Partial<Record<NativeCoreSyncMethod, (argsJson: string) => string>>

/** Sync wasm2js binding — no instantiate / ready step. */
export type BrowserJsBinding = Partial<
  Record<NativeCoreSyncMethod, (argsJson: string) => string>
> & {
  SOLVAPAY_BROWSER_JS_CORE?: string
}

type EnvelopeOk = { ok: true; value: unknown }
type EnvelopeErr = { ok: false; error: { kind: string; message: string } }
type Envelope = EnvelopeOk | EnvelopeErr

function isEnvelope(value: unknown): value is Envelope {
  if (typeof value !== 'object' || value === null || !('ok' in value)) return false
  const ok = (value as { ok: unknown }).ok
  return ok === true || ok === false
}

function unwrapEnvelope(envelopeJson: string): unknown {
  let envelope: unknown
  try {
    envelope = JSON.parse(envelopeJson) as unknown
  } catch {
    throw new SolvaPayError('SolvaPay browser WASM returned invalid JSON envelope')
  }
  if (!isEnvelope(envelope)) {
    throw new SolvaPayError('SolvaPay browser WASM returned malformed envelope')
  }
  if (envelope.ok) return envelope.value
  throw new SolvaPayError(envelope.error.message)
}

function callBrowserSync(
  binding: BrowserBinding | BrowserJsBinding,
  fn: NativeCoreSyncMethod,
  argsJson: string,
): unknown {
  const method = binding[fn]
  if (typeof method !== 'function') {
    throw new SolvaPayError(`SolvaPay browser WASM missing sync method: ${fn}`)
  }
  return unwrapEnvelope(method(argsJson))
}

export function installFromBinding(binding: BrowserBinding | BrowserJsBinding): void {
  installNativeCoreApi({
    callNativeSync: (fn, argsJson) => callBrowserSync(binding, fn, argsJson),
  })
}

/** `undefined` = not attempted; Promise caches in-flight / completed warm-up. */
let warmPromise: Promise<void> | undefined

export function getWarmPromise(): Promise<void> | undefined {
  return warmPromise
}

export function setWarmPromise(next: Promise<void> | undefined): void {
  warmPromise = next
}

export async function loadBrowserBinding(): Promise<BrowserBinding> {
  const mod = await import('@solvapay/server-wasm/browser')
  return mod as unknown as BrowserBinding
}

/**
 * Install the wasm2js browser core as the `@solvapay/core` sync dispatch.
 * Failures use a distinctly-worded error so they are not confused with
 * "core sync API not installed" or a missing sync method on a later call.
 */
export function installBrowserCoreJs(binding: BrowserJsBinding): void {
  try {
    if (typeof binding.resolveDisplayMode !== 'function') {
      throw new SolvaPayError('missing browser-js core')
    }
    installFromBinding(binding)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new SolvaPayError(`SolvaPay widget core failed to initialize: ${detail}`)
  }
}

export function resetBrowserCoreWasmInstallForTests(): void {
  warmPromise = undefined
  resetNativeCoreApiForTests()
}
