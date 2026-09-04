#!/usr/bin/env node
/* global console, process, fetch */
/**
 * Refresh the cached OpenAPI specs that drive `src/types/mcp/smoke.test.ts`.
 *
 * Run when a Petstore / PokeAPI release breaks an assertion. Downloads
 * the three pinned URLs into `src/types/mcp/__fixtures__/` and prints
 * a per-spec size + operation-count delta so the diff is easy to review.
 *
 * No assertion bumping is automated — read the diff and update the
 * smoke test by hand if the numbers shifted intentionally.
 *
 * Usage:
 *   node scripts/refresh-smoke-fixtures.mjs
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = resolve(HERE, '..', 'src', 'types', 'mcp', '__fixtures__')

const TARGETS = [
  {
    label: 'petstore v2 (Swagger 2.0)',
    url: 'https://petstore.swagger.io/v2/swagger.json',
    filename: 'petstore-v2.spec.json',
  },
  {
    label: 'petstore v3 (OpenAPI 3.0.4)',
    url: 'https://petstore3.swagger.io/api/v3/openapi.json',
    filename: 'petstore-v3.spec.json',
  },
  {
    label: 'pokeapi (OpenAPI 3.1)',
    url: 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/openapi.yml',
    filename: 'pokeapi.spec.yml',
  },
]

async function main() {
  await mkdir(FIXTURES_DIR, { recursive: true })
  for (const target of TARGETS) {
    const destPath = resolve(FIXTURES_DIR, target.filename)
    const before = await readIfExists(destPath)
    const beforeOps = before ? countOperations(target.filename, before) : null

    const res = await fetch(target.url)
    if (!res.ok) {
      throw new Error(`Fetch failed for ${target.url}: ${res.status} ${res.statusText}`)
    }
    const text = await res.text()
    await writeFile(destPath, text, 'utf8')

    const afterStat = await stat(destPath)
    const afterOps = countOperations(target.filename, text)

    process.stdout.write(`✓ ${target.label}\n`)
    process.stdout.write(`    ${target.filename}: ${formatBytes(afterStat.size)}`)
    if (before) {
      const sizeDelta = afterStat.size - Buffer.byteLength(before, 'utf8')
      process.stdout.write(` (Δ ${sizeDelta >= 0 ? '+' : ''}${formatBytes(sizeDelta)})`)
    }
    process.stdout.write('\n')
    process.stdout.write(`    operations: ${afterOps ?? '?'}`)
    if (beforeOps !== null && afterOps !== null) {
      const delta = afterOps - beforeOps
      process.stdout.write(` (Δ ${delta >= 0 ? '+' : ''}${delta})`)
    }
    process.stdout.write('\n')
  }
  process.stdout.write('\nReview `git diff` and update smoke.test.ts assertions if counts shifted.\n')
}

async function readIfExists(filePath) {
  try {
    return await readFile(filePath, 'utf8')
  } catch {
    return null
  }
}

/**
 * Best-effort operation count for the diff summary. Counts HTTP method
 * keys under `paths.*` — works on JSON and on YAML via a regex sniff
 * (good enough for the maintenance report; the smoke test parses the
 * real thing).
 */
function countOperations(filename, text) {
  if (filename.endsWith('.json')) {
    try {
      const spec = JSON.parse(text)
      return Object.values(spec.paths ?? {}).reduce((acc, pathItem) => {
        if (!pathItem || typeof pathItem !== 'object') return acc
        const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']
        return acc + methods.filter(m => typeof pathItem[m] === 'object').length
      }, 0)
    } catch {
      return null
    }
  }
  // YAML sniff: count operationId entries — every operation in the
  // current PokeAPI spec carries one.
  const matches = text.match(/^\s+operationId:\s/gm)
  return matches ? matches.length : null
}

function formatBytes(bytes) {
  const sign = bytes < 0 ? '-' : ''
  const abs = Math.abs(bytes)
  if (abs < 1024) return `${sign}${abs} B`
  if (abs < 1024 * 1024) return `${sign}${(abs / 1024).toFixed(1)} KB`
  return `${sign}${(abs / 1024 / 1024).toFixed(2)} MB`
}

main().catch(err => {
  console.error(err.stack ?? err.message ?? String(err))
  process.exit(1)
})
