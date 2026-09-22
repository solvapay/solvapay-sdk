/**
 * Import-time facade ↔ Node native version skew guard (§7.7).
 *
 * Python (`solvapay/__init__.py`) and Ruby (`lib/solvapay.rb`) compare the
 * package version with the loaded native module and raise `version_skew`.
 * This is the TypeScript equivalent for `@solvapay/server-native`.
 *
 * `@solvapay/server-native` is an optional dependency. `loadNativeBinding`
 * returns null when the addon is absent (unsupported platform, or a
 * Workers/edge host that resolved the Node entry). That is not skew — the
 * Node entry warms `@solvapay/server-wasm` instead. The guard runs only
 * after a native binary has loaded, and it fails when that binary's
 * `nativeBuildInfo` stamp disagrees with this package's version.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SolvaPayError } from '@solvapay/core'

const SERVER_PACKAGE = '@solvapay/server'

export type NativeStampBinding = {
  nativeBuildInfo?: () => string
}

type NativeBuildInfo = {
  version: string
  coreSha: string
}

function isBuildInfo(value: unknown): value is NativeBuildInfo {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const record = value as { version?: unknown; coreSha?: unknown }
  return (
    typeof record.version === 'string' &&
    record.version.length > 0 &&
    typeof record.coreSha === 'string'
  )
}

function packageVersionIfServer(pkgPath: string): string | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(pkgPath, 'utf8')) as unknown
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new SolvaPayError(
      `solvapay version skew: cannot read package version at ${pkgPath}: ${detail}`,
      { code: 'version_skew' },
    )
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new SolvaPayError(`solvapay version skew: ${pkgPath} is not a package.json object`, {
      code: 'version_skew',
    })
  }
  const record = raw as { name?: unknown; version?: unknown }
  if (record.name !== SERVER_PACKAGE) {
    return undefined
  }
  if (typeof record.version !== 'string' || record.version.length === 0) {
    throw new SolvaPayError(`solvapay version skew: ${pkgPath} is missing a version`, {
      code: 'version_skew',
    })
  }
  return record.version
}

/**
 * Reads `@solvapay/server`'s `version` by walking up from `startFile`.
 *
 * @throws {SolvaPayError} when the package manifest is missing or has no version
 */
export function readServerPackageVersion(startFile = fileURLToPath(import.meta.url)): string {
  let dir = path.dirname(startFile)
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(dir, 'package.json')
    if (existsSync(candidate)) {
      const version = packageVersionIfServer(candidate)
      if (version !== undefined) {
        return version
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      break
    }
    dir = parent
  }
  throw new SolvaPayError('solvapay version skew: cannot read @solvapay/server package version', {
    code: 'version_skew',
  })
}

function nativeVersionFromBinding(binding: NativeStampBinding): string {
  const readStamp = binding.nativeBuildInfo
  if (typeof readStamp !== 'function') {
    throw new SolvaPayError(
      'solvapay version skew: native binding loaded without nativeBuildInfo',
      { code: 'version_skew' },
    )
  }
  const raw = readStamp()
  if (typeof raw !== 'string') {
    throw new SolvaPayError(
      'solvapay version skew: nativeBuildInfo did not return a string stamp',
      { code: 'version_skew' },
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new SolvaPayError(
      `solvapay version skew: nativeBuildInfo returned invalid JSON: ${detail}`,
      { code: 'version_skew' },
    )
  }
  if (!isBuildInfo(parsed)) {
    throw new SolvaPayError('solvapay version skew: nativeBuildInfo returned a malformed stamp', {
      code: 'version_skew',
    })
  }
  return parsed.version
}

/**
 * Throws when a loaded native binding's release stamp disagrees with the
 * package version. A null binding (optional native not installed) returns.
 *
 * @throws {SolvaPayError} with `code: 'version_skew'`
 */
export function assertLoadedNativeMatchesPackage(binding: NativeStampBinding | null): void {
  if (binding === null) {
    return
  }
  const nativeVersion = nativeVersionFromBinding(binding)
  const packageVersion = readServerPackageVersion()
  if (nativeVersion !== packageVersion) {
    throw new SolvaPayError(
      `solvapay version skew: package=${JSON.stringify(packageVersion)} native=${JSON.stringify(nativeVersion)}`,
      { code: 'version_skew' },
    )
  }
}
