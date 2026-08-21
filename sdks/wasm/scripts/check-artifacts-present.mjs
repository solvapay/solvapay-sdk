#!/usr/bin/env node
/** Ensures committed WASM artifacts exist so turbo/pnpm build need not invoke Rust. */
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const required = [
  'pkg/edge/solvapay_wasm_bg.wasm',
  'pkg/edge/solvapay_wasm.js',
  'pkg/browser/solvapay_wasm_bg.wasm',
  'pkg/browser/solvapay_wasm.js',
]

for (const rel of required) {
  const abs = join(pkgRoot, rel)
  if (!existsSync(abs)) {
    console.error(`missing committed artifact: ${rel}`)
    console.error('Regenerate with: pnpm --filter @solvapay/server-wasm build:wasm')
    process.exit(1)
  }
}

console.log('OK: committed wasm artifacts present')
