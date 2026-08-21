/**
 * Canonical §7.7 native + WASI target metadata for artifact check, pack,
 * clean-install smoke, and CI matrix generation (Step 39).
 */

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

/** @type {readonly TargetSpec[]} */
export const NATIVE_TARGETS = Object.freeze([
  {
    dir: 'darwin-x64',
    packageName: '@solvapay/server-native-darwin-x64',
    rustTriple: 'x86_64-apple-darwin',
    kind: 'node',
    binary: 'server-native.darwin-x64.node',
    platform: 'darwin',
    arch: 'x64',
    libc: null,
    ciHost: 'macos-15-intel',
    ciContainer: null,
  },
  {
    dir: 'darwin-arm64',
    packageName: '@solvapay/server-native-darwin-arm64',
    rustTriple: 'aarch64-apple-darwin',
    kind: 'node',
    binary: 'server-native.darwin-arm64.node',
    platform: 'darwin',
    arch: 'arm64',
    libc: null,
    ciHost: 'macos-15',
    ciContainer: null,
  },
  {
    dir: 'linux-x64-gnu',
    packageName: '@solvapay/server-native-linux-x64-gnu',
    rustTriple: 'x86_64-unknown-linux-gnu',
    kind: 'node',
    binary: 'server-native.linux-x64-gnu.node',
    platform: 'linux',
    arch: 'x64',
    libc: 'glibc',
    ciHost: 'ubuntu-24.04',
    ciContainer: null,
  },
  {
    dir: 'linux-arm64-gnu',
    packageName: '@solvapay/server-native-linux-arm64-gnu',
    rustTriple: 'aarch64-unknown-linux-gnu',
    kind: 'node',
    binary: 'server-native.linux-arm64-gnu.node',
    platform: 'linux',
    arch: 'arm64',
    libc: 'glibc',
    ciHost: 'ubuntu-24.04-arm',
    ciContainer: null,
  },
  {
    dir: 'linux-x64-musl',
    packageName: '@solvapay/server-native-linux-x64-musl',
    rustTriple: 'x86_64-unknown-linux-musl',
    kind: 'node',
    binary: 'server-native.linux-x64-musl.node',
    platform: 'linux',
    arch: 'x64',
    libc: 'musl',
    ciHost: 'ubuntu-24.04',
    ciContainer: 'node:{nodeMajor}-alpine',
  },
  {
    dir: 'linux-arm64-musl',
    packageName: '@solvapay/server-native-linux-arm64-musl',
    rustTriple: 'aarch64-unknown-linux-musl',
    kind: 'node',
    binary: 'server-native.linux-arm64-musl.node',
    platform: 'linux',
    arch: 'arm64',
    libc: 'musl',
    ciHost: 'ubuntu-24.04-arm',
    ciContainer: 'node:{nodeMajor}-alpine',
  },
  {
    dir: 'win32-x64-msvc',
    packageName: '@solvapay/server-native-win32-x64-msvc',
    rustTriple: 'x86_64-pc-windows-msvc',
    kind: 'node',
    binary: 'server-native.win32-x64-msvc.node',
    platform: 'win32',
    arch: 'x64',
    libc: null,
    ciHost: 'windows-latest',
    ciContainer: null,
  },
  {
    dir: 'win32-arm64-msvc',
    packageName: '@solvapay/server-native-win32-arm64-msvc',
    rustTriple: 'aarch64-pc-windows-msvc',
    kind: 'node',
    binary: 'server-native.win32-arm64-msvc.node',
    platform: 'win32',
    arch: 'arm64',
    libc: null,
    ciHost: 'windows-11-arm',
    ciContainer: null,
  },
])

/** @type {TargetSpec} */
export const WASI_TARGET = Object.freeze({
  dir: 'wasm32-wasi',
  packageName: '@solvapay/server-native-wasm32-wasi',
  rustTriple: 'wasm32-wasip1-threads',
  kind: 'wasm',
  binary: 'server-native.wasm32-wasi.wasm',
  platform: 'wasi',
  arch: 'wasm32',
  libc: null,
  ciHost: 'ubuntu-24.04',
  ciContainer: null,
})

/** All nine publish targets (8 native + WASI). */
export const ALL_TARGETS = Object.freeze([...NATIVE_TARGETS, WASI_TARGET])

export const LOADER_PACKAGE_NAME = '@solvapay/server-native'
export const FACADE_PACKAGE_NAME = '@solvapay/server'
export const CORE_PACKAGE_NAME = '@solvapay/core'
export const SERVER_WASM_PACKAGE_NAME = '@solvapay/server-wasm'

/** Node majors required by Step 39. */
export const CLEAN_INSTALL_NODE_MAJORS = Object.freeze(['22', '24', '26'])

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
