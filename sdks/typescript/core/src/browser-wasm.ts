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
 *
 * The MCP App widget must not use this eager URL fetch. It imports
 * `browser-wasm-install` (or aliases this specifier onto it) and calls
 * {@link installBrowserCoreJs} with `@solvapay/server-wasm/browser-js`.
 */

import { SolvaPayError } from './solvapay-error'
import {
  getWarmPromise,
  installFromBinding,
  loadBrowserBinding,
  resetBrowserCoreWasmInstallForTests,
  setWarmPromise,
  type BrowserBinding,
} from './browser-wasm-install'

export { installBrowserCoreJs, installFromBinding } from './browser-wasm-install'

/**
 * Eagerly loads + instantiates the public-safe browser WASM and installs it as
 * the `@solvapay/core` sync dispatch. Started automatically on module import.
 * Idempotent; safe to call from multiple components.
 */
export function warmBrowserCoreWasm(): Promise<void> {
  const existing = getWarmPromise()
  if (existing) return existing

  const warm = loadBrowserBinding()
    .then(async (binding: BrowserBinding) => {
      try {
        binding.ensureReadySync?.()
      } catch {
        // ensureReadySync throws without a precompiled module — use ready().
      }
      await binding.ready()
      installFromBinding(binding)
    })
    .catch(err => {
      if (getWarmPromise() === warm) {
        setWarmPromise(undefined)
      }
      if (err instanceof SolvaPayError) throw err
      throw new SolvaPayError(
        err instanceof Error
          ? err.message
          : 'SolvaPay browser WASM (@solvapay/server-wasm/browser) failed to initialize',
      )
    })
  setWarmPromise(warm)
  return warm
}

/** Eager install — starts on import so React does not need an explicit warm-up.
 * Swallow at this call site only: Node/SSR/vitest evaluate this module without a
 * real browser WASM fetch, and an unhandled rejection would terminate the process.
 * Explicit `warmBrowserCoreWasm()` / `whenBrowserCoreWasmReady()` callers still
 * observe the rejection (mirrors `warmWasm()` in `@solvapay/server`). */
void warmBrowserCoreWasm().catch(() => undefined)

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
  resetBrowserCoreWasmInstallForTests()
}
