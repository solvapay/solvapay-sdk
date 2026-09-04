/**
 * Process-wide sync native dispatch handle (Step 37R-d).
 *
 * Published by the Node `@solvapay/server` entry so `@solvapay/mcp-core`
 * (and peers) can pick up napi dispatch without a hard server→mcp-core
 * import cycle and without `createRequire` (which only mutates the CJS
 * module instance — ESM consumers would miss the install).
 *
 * Edge builds never call `publishNativeSyncApi`.
 */

import { callNativeSync } from './native'

export const SOLVAPAY_NATIVE_SYNC_API = Symbol.for('solvapay.nativeSyncApi')

export type NativeSyncApi = {
  callNativeSync: typeof callNativeSync
}

export function publishNativeSyncApi(): void {
  const g = globalThis as typeof globalThis & {
    [SOLVAPAY_NATIVE_SYNC_API]?: NativeSyncApi
  }
  g[SOLVAPAY_NATIVE_SYNC_API] = { callNativeSync }
}

/** @internal test helper — clears the ambient registry. */
export function resetNativeSyncApiForTests(): void {
  const g = globalThis as typeof globalThis & {
    [SOLVAPAY_NATIVE_SYNC_API]?: NativeSyncApi
  }
  delete g[SOLVAPAY_NATIVE_SYNC_API]
}

export function readNativeSyncApi(): NativeSyncApi | null {
  const g = globalThis as typeof globalThis & {
    [SOLVAPAY_NATIVE_SYNC_API]?: NativeSyncApi
  }
  return g[SOLVAPAY_NATIVE_SYNC_API] ?? null
}
