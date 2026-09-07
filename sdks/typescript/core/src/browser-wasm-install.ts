/**
 * Install `@solvapay/core` sync dispatch from the public-safe browser WASM.
 *
 * No eager URL fetch — the MCP App widget inlines WASM bytes and calls
 * {@link installBrowserCoreFromBytes} / {@link installBrowserCoreFromBase64}
 * before first render. The URL-warming entry stays in `browser-wasm.ts`.
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
  binding: BrowserBinding,
  fn: NativeCoreSyncMethod,
  argsJson: string,
): unknown {
  const method = binding[fn]
  if (typeof method !== 'function') {
    throw new SolvaPayError(`SolvaPay browser WASM missing sync method: ${fn}`)
  }
  return unwrapEnvelope(method(argsJson))
}

export function installFromBinding(binding: BrowserBinding): void {
  installNativeCoreApi({
    callNativeSync: (fn, argsJson) => callBrowserSync(binding, fn, argsJson),
  })
}

function decodeBase64ToBytes(encoded: string): ArrayBuffer {
  const binary = atob(encoded)
  const buffer = new ArrayBuffer(binary.length)
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return buffer
}

function wrapInitError(err: unknown): SolvaPayError {
  if (err instanceof SolvaPayError) return err
  return new SolvaPayError(
    err instanceof Error
      ? err.message
      : 'SolvaPay browser WASM (@solvapay/server-wasm/browser) failed to initialize',
  )
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
 * Instantiate the public-safe browser WASM from inlined bytes and install
 * it as the `@solvapay/core` sync dispatch. Replaces any in-flight URL
 * warm-up so a later fetch failure cannot clear a successful bytes install.
 */
export function installBrowserCoreFromBytes(bytes: BufferSource): Promise<void> {
  const install = loadBrowserBinding()
    .then(async binding => {
      if (typeof binding.readyFromBytes === 'function') {
        await binding.readyFromBytes(bytes)
      } else {
        await binding.ready(bytes)
      }
      installFromBinding(binding)
    })
    .catch(err => {
      if (warmPromise === install) {
        warmPromise = undefined
      }
      throw wrapInitError(err)
    })
  warmPromise = install
  return install
}

/**
 * Decode a base64-encoded browser WASM (not a `data:` URL) and install it.
 * Failures use a distinctly-worded error so they are not confused with
 * "core sync API not installed".
 */
export async function installBrowserCoreFromBase64(encoded: string): Promise<void> {
  if (encoded.trim() === '') {
    throw new SolvaPayError(
      'SolvaPay widget WASM failed to initialize: missing inlined browser core',
    )
  }
  try {
    await installBrowserCoreFromBytes(decodeBase64ToBytes(encoded))
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new SolvaPayError(`SolvaPay widget WASM failed to initialize: ${detail}`)
  }
}

export function resetBrowserCoreWasmInstallForTests(): void {
  warmPromise = undefined
  resetNativeCoreApiForTests()
}
