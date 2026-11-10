#!/usr/bin/env node
/**
 * Keeps the `@solvapay/*` pins in `templates/mcp/_base/package.json` on npm's
 * `latest`. Scaffolds use those pins only with `--offline`, and people copy
 * the template, so stale pins start projects behind the SDK.
 *
 *   node scripts/sync-sdk-pins.mjs           # write npm's latest into the template
 *   node scripts/sync-sdk-pins.mjs --check   # exit 1 when any pin differs
 *
 * Run it after each stable release (the "sync dev after release" PR). The
 * scaffold test "template pins are npm's latest" fails until it has run.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEPS = ['@solvapay/mcp', '@solvapay/mcp-core', '@solvapay/server', '@solvapay/react']
const TEMPLATE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'templates',
  'mcp',
  '_base',
  'package.json',
)

async function latest(name) {
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}/latest`
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  const { version } = await response.json()
  if (typeof version !== 'string' || !version) throw new Error(`${url} returned no version`)
  return version
}

const check = process.argv.includes('--check')
const raw = await readFile(TEMPLATE, 'utf8')
const pkg = JSON.parse(raw)
const drift = []
for (const name of DEPS) {
  const want = await latest(name)
  const have = pkg.dependencies?.[name]
  if (have === undefined) throw new Error(`${TEMPLATE} has no pin for ${name}`)
  if (have !== want) {
    drift.push(`${name}: template ${have}, npm latest ${want}`)
    pkg.dependencies[name] = want
  }
}

if (drift.length === 0) {
  console.log('Template @solvapay/* pins match npm latest.')
} else if (check) {
  console.error(
    `Template @solvapay/* pins are behind npm latest:\n  ${drift.join('\n  ')}\nRun: node packages/create-solvapay/scripts/sync-sdk-pins.mjs`,
  )
  process.exit(1)
} else {
  await writeFile(
    TEMPLATE,
    `${JSON.stringify(pkg, null, 2)}${raw.endsWith('\n') ? '\n' : ''}`,
    'utf8',
  )
  console.log(`Updated ${TEMPLATE}:\n  ${drift.join('\n  ')}`)
}
