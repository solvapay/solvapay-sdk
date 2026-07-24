/**
 * Eager browser WASM install for `@solvapay/core` public-safe pure logic
 * (Step 38R-e / Step 52).
 *
 * Importing this module starts WASM warm-up and installs the core sync
 * dispatch as soon as `ready()` resolves. After Step 52 there is no TypeScript
 * fallback — call sites must import this entry (or wait for
 * {@link warmBrowserCoreWasm}) before using domain sync APIs.
 *
 * Prefer importing `@solvapay/core/browser-wasm` from React / browser bundles
 * so dispatch is installed before first render. {@link warmBrowserCoreWasm}
 * remains for back-compat and awaits the same in-flight install.
 */

import {
  installNativeCoreApi,
  resetNativeCoreApiForTests,
  type NativeCoreSyncMethod,
  type SolvaPayImpl,
} from './native-core'
import { SolvaPayError } from './solvapay-error'

/** Async ready + the public-safe sync envelope functions on the browser binding. */
type BrowserBinding = {
  ready: () => Promise<void>
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

function installFromBinding(binding: BrowserBinding): void {
  installNativeCoreApi({
    resolveImpl: (): SolvaPayImpl => 'rust',
    callNativeSync: (fn, argsJson) => callBrowserSync(binding, fn, argsJson),
  })
}

/** `undefined` = not attempted; Promise caches in-flight / completed warm-up. */
let warmPromise: Promise<void> | undefined

/**
 * Eagerly loads + instantiates the public-safe browser WASM and installs it as
 * the `@solvapay/core` sync dispatch. Started automatically on module import.
 * Idempotent; safe to call from multiple components.
 */
export function warmBrowserCoreWasm(): Promise<void> {
  if (!warmPromise) {
    warmPromise = import('@solvapay/server-wasm/browser')
      .then(async mod => {
        const binding = mod as unknown as BrowserBinding
        // Prefer sync init when the runtime already has a compiled module
        // (bundlers / workerd); otherwise fall through to async `ready()`.
        try {
          binding.ensureReadySync?.()
        } catch {
          // ensureReadySync throws without a precompiled module — use ready().
        }
        await binding.ready()
        installFromBinding(binding)
      })
      .catch(err => {
        warmPromise = undefined
        if (err instanceof SolvaPayError) throw err
        throw new SolvaPayError(
          err instanceof Error
            ? err.message
            : 'SolvaPay browser WASM (@solvapay/server-wasm/browser) failed to initialize',
        )
      })
  }
  return warmPromise
}

/** Eager install — starts on import so React does not need an explicit warm-up. */
void warmBrowserCoreWasm()

/**
 * Resolves when the (re)install has completed. Safe after test resets.
 * @internal test helper / advanced callers
 */
export function whenBrowserCoreWasmReady(): Promise<void> {
  return warmBrowserCoreWasm()
}

/**
 * Resets warm-up state and the installed core API.
 * @internal test helper
 */
export function resetBrowserCoreWasmForTests(): void {
  warmPromise = undefined
  resetNativeCoreApiForTests()
}
