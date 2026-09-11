/**
 * Node-only: install mcp-core napi delegation when this package loads.
 *
 * Edge/Deno consumers use `@solvapay/mcp/fetch` (not this module) and
 * pick up WASM dispatch from `@solvapay/server/edge` (`publishWasmSyncApi`).
 */

import { installNativeMcpApi } from '@solvapay/mcp-core'
import { callNativeSync } from '@solvapay/server'

function isNodeRuntime(): boolean {
  try {
    return (
      typeof process !== 'undefined' &&
      typeof process.versions === 'object' &&
      process.versions != null &&
      typeof process.versions.node === 'string'
    )
  } catch {
    return false
  }
}

if (isNodeRuntime()) {
  installNativeMcpApi({ callNativeSync })
}
