/**
 * §7.7 build stamp for the Node native addon.
 *
 * Reads `{version, coreSha}` from `@solvapay/server-native`. This is binding
 * infrastructure, not a catalog op — see `contract/delegation-allowlist.json`.
 * Opt-in diagnostics only. The import-time skew guard lives in
 * `version-skew.ts` and runs from `loadNativeBinding` when a binary is loaded.
 */

import { createRequire } from 'node:module'
import { SolvaPayError } from '@solvapay/core'

const require = createRequire(import.meta.url)

export type NativeBuildInfo = {
  version: string
  coreSha: string
}

function isBuildInfo(value: unknown): value is NativeBuildInfo {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const record = value as { version?: unknown; coreSha?: unknown }
  return typeof record.version === 'string' && typeof record.coreSha === 'string'
}

/**
 * Returns `{version, coreSha}` from the installed native addon.
 *
 * @throws {SolvaPayError} when the addon is missing or the stamp is malformed
 */
export function nativeBuildInfo(): NativeBuildInfo {
  const binding = require('@solvapay/server-native') as {
    nativeBuildInfo?: () => string
  }
  const raw = binding.nativeBuildInfo?.()
  if (typeof raw !== 'string') {
    throw new SolvaPayError('nativeBuildInfo is not available on this install')
  }
  const parsed: unknown = JSON.parse(raw)
  if (!isBuildInfo(parsed)) {
    throw new SolvaPayError('nativeBuildInfo returned a malformed stamp')
  }
  return parsed
}
