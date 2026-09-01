#!/usr/bin/env node
/**
 * Step 39 clean-install smoke entry point (local + CI).
 *
 * Usage:
 *   node scripts/clean-install-smoke.mjs --bundle-dir <dir> --mode native --target darwin-arm64
 *   node scripts/clean-install-smoke.mjs --bundle-dir <dir> --mode native --target darwin-arm64 --preserve-on-failure
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runCleanInstallSmoke } from './clean-install-lib.mjs'
import { detectHostNativeTarget } from './targets.mjs'

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {string | null} */
  let bundleDir = null
  /** @type {'native' | null} */
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
      mode = /** @type {'native'} */ (argv[++i])
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
  if (mode !== 'native') {
    throw new Error('clean-install-smoke: --mode native is required')
  }
  if (!target) {
    target = detectHostNativeTarget().dir
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
  if (err instanceof Error) {
    console.error(`clean-install-smoke: ${err.message}`)
    if (err.stack) console.error(err.stack)
  } else {
    console.error('clean-install-smoke:', err)
  }
  process.exit(1)
})
