#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CANONICAL_REL, SDK_COPIES } from './targets.mjs'

const MIN_BUNDLE_BYTES = 100 * 1024

export function checkVendoredWidget({ root }) {
  const canonicalPath = join(root, CANONICAL_REL)
  const canonical = readFileSync(canonicalPath)
  const expected = createHash('sha256').update(canonical).digest('hex')
  const html = canonical.toString('utf8')
  const problems = []

  for (const rel of SDK_COPIES) {
    const bytes = readFileSync(join(root, rel))
    const actual = createHash('sha256').update(bytes).digest('hex')
    if (actual !== expected) {
      problems.push(`${rel} drifted from ${CANONICAL_REL}`)
    }
  }

  if (!html.includes('id="root"')) {
    problems.push('Canonical widget is missing id="root"')
  }
  if (!html.includes('<script')) {
    problems.push('Canonical widget is missing a bundled <script>')
  }
  if (!html.includes('solvapay://bootstrap.json')) {
    problems.push('Canonical widget is missing solvapay://bootstrap.json')
  }
  if (canonical.length < MIN_BUNDLE_BYTES) {
    problems.push(
      `Canonical widget is ${canonical.length} bytes; expected a Vite bundle over ${MIN_BUNDLE_BYTES} bytes`,
    )
  }

  return problems
}

function isCli(url) {
  const entry = process.argv[1]
  return Boolean(entry) && fileURLToPath(url) === resolve(entry)
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
  const problems = checkVendoredWidget({ root })
  if (problems.length > 0) {
    console.error('Vendored MCP App widget check failed:')
    for (const problem of problems) console.error(`  ${problem}`)
    console.error('Run: pnpm --filter @solvapay/mcp-app-widget build && node tools/mcp-app-widget/vendor.mjs')
    process.exit(1)
  }
  console.log('mcp-app.html vendored copies match')
}

if (isCli(import.meta.url)) {
  main()
}
