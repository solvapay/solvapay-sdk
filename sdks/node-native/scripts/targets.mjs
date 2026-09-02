/**
 * Canonical §7.7 native target metadata. Rows come from
 * `contract/manifest/support-matrix.yaml` via the JSON snapshot.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** @typedef {{
 *   dir: string
 *   packageName: string
 *   rustTriple: string
 *   kind: 'node' | 'wasm'
 *   binary: string
 *   platform: string
 *   arch: string
 *   libc: string | null
 *   ciHost: string
 *   ciContainer: string | null
 * }} TargetSpec */

const MATRIX_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../contract/manifest/support-matrix.json',
)

/** @type {{ nodeNative: { targets: TargetSpec[], nodeMajors: string[] } }} */
const SUPPORT_MATRIX = JSON.parse(readFileSync(MATRIX_PATH, 'utf8'))

/** @type {readonly TargetSpec[]} */
export const NATIVE_TARGETS = Object.freeze(SUPPORT_MATRIX.nodeNative.targets)

/** All eight native publish targets. */
export const ALL_TARGETS = Object.freeze([...NATIVE_TARGETS])

export const LOADER_PACKAGE_NAME = '@solvapay/server-native'
export const FACADE_PACKAGE_NAME = '@solvapay/server'
export const CORE_PACKAGE_NAME = '@solvapay/core'
export const SERVER_WASM_PACKAGE_NAME = '@solvapay/server-wasm'

/** Node majors required by Step 39. */
export const CLEAN_INSTALL_NODE_MAJORS = Object.freeze(SUPPORT_MATRIX.nodeNative.nodeMajors)

/**
 * @param {string} dir
 * @returns {TargetSpec}
 */
export function targetByDir(dir) {
  const found = ALL_TARGETS.find(t => t.dir === dir)
  if (!found) {
    throw new Error(`Unknown target dir: ${dir}`)
  }
  return found
}

/**
 * Resolve the host native target dir from process + optional libc hint.
 * @param {{ platform?: string, arch?: string, libc?: string | null }} [hint]
 * @returns {TargetSpec}
 */
export function detectHostNativeTarget(hint = {}) {
  const platform = hint.platform ?? process.platform
  const arch = hint.arch ?? process.arch
  const libc = hint.libc ?? detectLibc(platform)

  const match = NATIVE_TARGETS.find(
    t =>
      t.platform === platform &&
      t.arch === arch &&
      (t.libc === null ? true : t.libc === libc),
  )
  if (!match) {
    throw new Error(
      `No native target for platform=${platform} arch=${arch} libc=${libc ?? 'n/a'}`,
    )
  }
  return match
}

/**
 * @param {string} platform
 * @returns {string | null}
 */
export function detectLibc(platform = process.platform) {
  if (platform !== 'linux') return null
  try {
    const report = process.report?.getReport?.()
    const glibc = report?.header?.glibcVersionRuntime
    if (typeof glibc === 'string' && glibc.length > 0) return 'glibc'
  } catch {
    // fall through
  }
  // Alpine / musl Node typically has no glibcVersionRuntime.
  return 'musl'
}
