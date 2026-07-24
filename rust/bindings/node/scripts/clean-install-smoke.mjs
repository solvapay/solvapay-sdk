#!/usr/bin/env node
/**
 * Step 39 clean-install smoke entry point (local + CI).
 *
 * Usage:
 *   node scripts/clean-install-smoke.mjs --bundle-dir <dir> --mode native --target darwin-arm64
 *   node scripts/clean-install-smoke.mjs --bundle-dir <dir> --mode wasi --target wasm32-wasi
 *   node scripts/clean-install-smoke.mjs --bundle-dir <dir> --mode native --target darwin-arm64 --preserve-on-failure
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runCleanInstallSmoke } from './clean-install-lib.mjs'
import { detectHostNativeTarget, WASI_TARGET } from './targets.mjs'

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {string | null} */
  let bundleDir = null
  /** @type {'native' | 'wasi' | null} */
  let mode = null
  /** @type {string | null} */
  let target = null
  let preserveOnFailure = false
  /** @type {string | undefined} */
  let nodeMajor

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--bundle-dir' && argv[i + 1]) {
      bundleDir = resolve(argv[++i])
    } else if (arg === '--mode' && argv[i + 1]) {
      mode = /** @type {'native' | 'wasi'} */ (argv[++i])
    } else if (arg === '--target' && argv[i + 1]) {
      target = argv[++i]
    } else if (arg === '--preserve-on-failure') {
      preserveOnFailure = true
    } else if (arg === '--node-major' && argv[i + 1]) {
      nodeMajor = argv[++i]
    }
  }

  if (!bundleDir) {
    throw new Error('clean-install-smoke: --bundle-dir <dir> is required')
  }
  if (mode !== 'native' && mode !== 'wasi') {
    throw new Error('clean-install-smoke: --mode native|wasi is required')
  }
  if (!target) {
    target = mode === 'wasi' ? WASI_TARGET.dir : detectHostNativeTarget().dir
  }

  return { bundleDir, mode, target, preserveOnFailure, nodeMajor }
}

async function main() {
  const { bundleDir, mode, target, preserveOnFailure, nodeMajor } = parseArgs(
    process.argv.slice(2),
  )
  const manifest = JSON.parse(readFileSync(resolve(bundleDir, 'manifest.json'), 'utf8'))
  await runCleanInstallSmoke({
    mode,
    expectedTargetDir: target,
    bundleDir,
    manifest,
    preserveOnFailure,
    nodeMajor,
  })
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
