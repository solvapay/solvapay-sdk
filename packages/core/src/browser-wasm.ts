/**
 * Opt-in browser WASM warm-up for `@solvapay/core` public-safe pure logic
 * (Step 38R-e).
 *
 * NOT imported by the main entry: React / browser consumers default to the
 * TypeScript fallback (§7.9 — the React package + its tests run unmodified).
 * Call {@link warmBrowserCoreWasm} to asynchronously load the public-safe
 * browser WASM (`@solvapay/server-wasm/browser`) and install it as the core
 * sync dispatch. After warm-up, `validateBusinessDetails` / credit-display /
 * seller-identity read from WASM; before warm-up (or if it fails) they stay on
 * TS. This keeps the main-thread eager cost at zero — the ~public-safe WASM is
 * only fetched/instantiated when the app opts in.
 */

import {
  installNativeCoreApi,
  resetNativeCoreApiForTests,
  type NativeCoreSyncMethod,
  type SolvaPayImpl,
} from './native-core'
import { SolvaPayError } from './index'

/** Async ready + the public-safe sync envelope functions on the browser binding. */
type BrowserBinding = {
  ready: () => Promise<void>
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

/** `undefined` = not attempted; Promise caches in-flight / completed warm-up. */
let warmPromise: Promise<void> | undefined

/**
 * Loads + instantiates the public-safe browser WASM and installs it as the
 * `@solvapay/core` sync dispatch. Idempotent; safe to call from multiple
 * components. Rejects (and clears the cache so a retry can re-attempt) if the
 * module fails to load — callers may ignore the rejection to keep the TS path.
 */
export function warmBrowserCoreWasm(): Promise<void> {
  if (!warmPromise) {
    warmPromise = import('@solvapay/server-wasm/browser')
      .then(async mod => {
        const binding = mod as unknown as BrowserBinding
        await binding.ready()
        installNativeCoreApi({
          resolveImpl: (): SolvaPayImpl => 'rust',
          callNativeSync: (fn, argsJson) => callBrowserSync(binding, fn, argsJson),
        })
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

/**
 * Resets warm-up state and the installed core API. Reverts sync accessors to
 * the TypeScript fallback.
 * @internal test helper
 */
export function resetBrowserCoreWasmForTests(): void {
  warmPromise = undefined
  resetNativeCoreApiForTests()
}
