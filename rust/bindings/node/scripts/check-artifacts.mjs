#!/usr/bin/env node
/**
 * Pre-publish artifact gate (step 36 / redesign §10.3).
 *
 * The napi CLI warns-and-continues when a target artifact is missing at publish
 * time — this script hard-fails instead.
 *
 * Usage:
 *   node scripts/check-artifacts.mjs
 *   node scripts/check-artifacts.mjs --dir <npm-root>
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ALL_TARGETS } from './targets.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

function parseArgs(argv) {
  let npmRoot = join(ROOT, 'npm')
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir' && argv[i + 1]) {
      npmRoot = argv[++i]
    }
  }
  return { npmRoot }
}

function main() {
  const { npmRoot } = parseArgs(process.argv.slice(2))
  const missing = []
  const present = []

  if (!existsSync(npmRoot)) {
    console.error(`check-artifacts: npm root missing: ${npmRoot}`)
    process.exit(1)
  }

  for (const entry of ALL_TARGETS) {
    const dirPath = join(npmRoot, entry.dir)
    if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) {
      missing.push(`${entry.dir}/ (directory)`)
      continue
    }

    const artifactPath = join(dirPath, entry.binary)
    if (existsSync(artifactPath) && statSync(artifactPath).isFile()) {
      present.push(entry.dir)
      continue
    }

    // Also accept any single .node / .wasm in the dir (napi artifacts layout).
    const files = readdirSync(dirPath).filter(f =>
      entry.kind === 'wasm' ? f.endsWith('.wasm') : f.endsWith('.node'),
    )
    if (files.length === 1) {
      present.push(entry.dir)
      continue
    }

    missing.push(`${entry.dir}/${entry.binary}`)
  }

  if (missing.length > 0) {
    console.error('check-artifacts: HARD FAIL — missing artifacts:')
    for (const m of missing) {
      console.error(`  - ${m}`)
    }
    console.error(`present: ${present.length}/${ALL_TARGETS.length}`)
    process.exit(1)
  }

  console.log(`check-artifacts: OK — ${present.length}/${ALL_TARGETS.length} artifacts present`)
  process.exit(0)
}

main()
