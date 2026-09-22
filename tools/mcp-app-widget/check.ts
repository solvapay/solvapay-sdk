#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { joinRel, lookupRel, REPO_ROOT } from '../shared/paths.js'
import { mcpAppWidgetLayout } from '../shared/repo-paths.js'

const MIN_BUNDLE_BYTES = 1_200 * 1024

function parseNativeCoreSyncMethods(source: string): Set<string> {
  return new Set([...source.matchAll(/\|\s*'([A-Za-z0-9_]+)'/g)].map(match => match[1]))
}

export function checkWidgetCoreCoverage({ root }: { root: string }): string[] {
  const symbols = JSON.parse(
    readFileSync(joinRel(root, lookupRel('wasmBrowserSymbols')), 'utf8'),
  ) as { browserSafe: string[] }
  const methods = parseNativeCoreSyncMethods(
    readFileSync(joinRel(root, lookupRel('coreNativeDispatch')), 'utf8'),
  )
  const runtime = readFileSync(joinRel(root, lookupRel('wasmBrowserRuntime')), 'utf8')
  const install = readFileSync(joinRel(root, lookupRel('coreBrowserWasmInstall')), 'utf8')
  const problems: string[] = []
  if (!install.includes('installFromBinding') || !install.includes('installBrowserCoreJs')) {
    problems.push(
      'Widget install must use the wasm2js browser binding (installFromBinding + installBrowserCoreJs)',
    )
  }
  for (const name of symbols.browserSafe) {
    if (!methods.has(name)) continue
    if (!runtime.includes(name)) {
      problems.push(`browser WASM runtime missing ${name} required by widget core coverage`)
    }
  }
  return problems
}

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

  const distPath = joinRel(root, layout.distRel)
  if (existsSync(distPath)) {
    const distHash = createHash('sha256').update(readFileSync(distPath)).digest('hex')
    if (distHash !== expected) {
      problems.push(`${layout.distRel} drifted from ${layout.canonicalRel}`)
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
  if (html.includes('href="data:')) {
    problems.push('Canonical widget must not load data: URLs (host connect-src rejects them)')
  }
  if (html.includes('WebAssembly') || html.includes('application/wasm')) {
    problems.push('Canonical widget must not reference the WebAssembly API')
  }
  if (!html.includes('solvapay-browser-js-core')) {
    problems.push('Canonical widget must embed the wasm2js browser core')
  }
  if (canonical.length < MIN_BUNDLE_BYTES) {
    problems.push(
      `Canonical widget is ${canonical.length} bytes; expected a Vite bundle over ${MIN_BUNDLE_BYTES} bytes`,
    )
  }

  return problems
}

function main(): void {
  const problems = [
    ...checkVendoredWidget({ root: REPO_ROOT }),
    ...checkWidgetCoreCoverage({ root: REPO_ROOT }),
  ]
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
