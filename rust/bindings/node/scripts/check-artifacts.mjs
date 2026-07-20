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

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

/** Expected platform package dirs under npm/ (§7.7 matrix + WASI). */
const EXPECTED = [
  { dir: 'darwin-x64', kind: 'node', binary: 'server-native.darwin-x64.node' },
  { dir: 'darwin-arm64', kind: 'node', binary: 'server-native.darwin-arm64.node' },
  { dir: 'linux-x64-gnu', kind: 'node', binary: 'server-native.linux-x64-gnu.node' },
  { dir: 'linux-arm64-gnu', kind: 'node', binary: 'server-native.linux-arm64-gnu.node' },
  { dir: 'linux-x64-musl', kind: 'node', binary: 'server-native.linux-x64-musl.node' },
  { dir: 'linux-arm64-musl', kind: 'node', binary: 'server-native.linux-arm64-musl.node' },
  { dir: 'win32-x64-msvc', kind: 'node', binary: 'server-native.win32-x64-msvc.node' },
  { dir: 'win32-arm64-msvc', kind: 'node', binary: 'server-native.win32-arm64-msvc.node' },
  { dir: 'wasm32-wasi', kind: 'wasm', binary: 'server-native.wasm32-wasi.wasm' },
]

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

  for (const entry of EXPECTED) {
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
    console.error(`present: ${present.length}/${EXPECTED.length}`)
    process.exit(1)
  }

  console.log(`check-artifacts: OK — ${present.length}/${EXPECTED.length} artifacts present`)
  process.exit(0)
}

main()
