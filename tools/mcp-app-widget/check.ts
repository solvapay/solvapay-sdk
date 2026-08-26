#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { joinRel, REPO_ROOT } from '../shared/paths.js'
import { mcpAppWidgetLayout } from '../shared/repo-paths.js'

const MIN_BUNDLE_BYTES = 100 * 1024

export function checkVendoredWidget({ root }: { root: string }): string[] {
  const layout = mcpAppWidgetLayout()
  const canonicalPath = joinRel(root, layout.canonicalRel)
  const canonical = readFileSync(canonicalPath)
  const expected = createHash('sha256').update(canonical).digest('hex')
  const html = canonical.toString('utf8')
  const problems: string[] = []

  for (const rel of layout.copiesRel) {
    const bytes = readFileSync(joinRel(root, rel))
    const actual = createHash('sha256').update(bytes).digest('hex')
    if (actual !== expected) {
      problems.push(`${rel} drifted from ${layout.canonicalRel}`)
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
  if (!html.includes('no portable fallback for')) {
    problems.push('Canonical widget is missing portable core fallback dispatch')
  }
  // Unique to `portable-fallbacks.ts`. The dispatch throw string is not enough —
  // Vite can tree-shake the side-effect-only `import '@solvapay/core/portable'`
  // and still keep `dispatchSync`'s error message, which blanks the MCP Jam iframe.
  if (!html.includes('EIN (Employer Identification Number)')) {
    problems.push('Canonical widget is missing portable core fallback implementations')
  }
  if (canonical.length < MIN_BUNDLE_BYTES) {
    problems.push(
      `Canonical widget is ${canonical.length} bytes; expected a Vite bundle over ${MIN_BUNDLE_BYTES} bytes`,
    )
  }

  return problems
}

function main(): void {
  const problems = checkVendoredWidget({ root: REPO_ROOT })
  if (problems.length > 0) {
    console.error('Vendored MCP App widget check failed:')
    for (const problem of problems) console.error(`  ${problem}`)
    console.error('Rebuild the MCP App widget package, then run its vendor script')
    process.exit(1)
  }
  console.log('mcp-app.html vendored copies match')
}

const entry = process.argv[1]
if (entry !== undefined && fileURLToPath(import.meta.url) === resolve(entry)) {
  main()
}
