#!/usr/bin/env node
/**
 * Post-publish verification — closes the gap between what Changesets
 * reports and what is actually on the npm registry.
 *
 * `changesets/cli` calls `npm publish` under the hood and trusts the
 * exit code. But npm has been observed to exit 0 even when the backend
 * refused to create a brand-new scoped package name (granular-token
 * scope, org "restrict package creation" settings, 2FA requirements on
 * first create, CDN propagation lag for first-ever publish of a name,
 * etc.) — and because Changesets swallows npm's stderr on success, the
 * signal never surfaces in the workflow log.
 *
 * We therefore run this script after every publish step:
 *
 *   1. Parse the list of packages Changesets claimed to publish —
 *      either from the raw publish log (preview workflow, which uses
 *      `pnpm changeset publish` directly) or from the JSON emitted by
 *      `changesets/action@v1` (stable workflow).
 *   2. For each `name@version`, poll `registry.npmjs.org` until the
 *      exact version manifest returns 200 (retries cover brand-new
 *      first-publish CDN lag; up to 60s per package).
 *   3. Exit non-zero if any package is still missing, with a clear
 *      summary of what's missing so CI fails loud.
 *
 * Usage:
 *
 *   # parse a captured publish log (preview workflow)
 *   node scripts/verify-npm-publishes.mjs publish.log
 *
 *   # consume `changesets/action` output (stable workflow)
 *   node scripts/verify-npm-publishes.mjs \
 *     --packages='[{"name":"@solvapay/mcp","version":"0.1.0"}]'
 *
 * Exits 0 on success or when there are no packages to verify; 1 on
 * verification failure; 2 on usage error.
 */

import { readFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const REGISTRY = 'https://registry.npmjs.org'
const MAX_ATTEMPTS = 6
const RETRY_MS = 10_000

function parseChangesetsLog(text) {
  const stripped = text.replace(/\x1b\[[0-9;]*m/g, '')
  const successIdx = stripped.indexOf('packages published successfully')
  if (successIdx === -1) return []
  const tail = stripped.slice(successIdx)
  const pattern = /^🦋\s+(@?[a-z0-9._-]+(?:\/[a-z0-9._-]+)?)@(\S+)$/gm
  const out = []
  let m
  while ((m = pattern.exec(tail)) !== null) {
    out.push({ name: m[1], version: m[2] })
  }
  return out
}

function parsePackagesFlag(value) {
  if (!value || value === '[]') return []
  let parsed
  try {
    parsed = JSON.parse(value)
  } catch (err) {
    throw new Error(
      `--packages must be a JSON array, got: ${value.slice(0, 200)} (${err.message})`,
    )
  }
  if (!Array.isArray(parsed)) {
    throw new Error('--packages must decode to a JSON array')
  }
  return parsed.map((entry) => {
    if (!entry?.name || !entry?.version) {
      throw new Error(
        `each --packages entry needs { name, version }; got: ${JSON.stringify(entry)}`,
      )
    }
    return { name: entry.name, version: entry.version }
  })
}

async function checkOne(name, version) {
  const url = `${REGISTRY}/${name}/${version}`
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } })
      if (res.ok) return true
      if (res.status !== 404) {
        console.log(`  ${name}@${version}: unexpected ${res.status}, retrying...`)
      }
    } catch (err) {
      console.log(`  ${name}@${version}: fetch error (${err.message}), retrying...`)
    }
    if (attempt < MAX_ATTEMPTS) await sleep(RETRY_MS)
  }
  return false
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    console.error(
      'Usage: verify-npm-publishes.mjs <publish-log> | --packages=<json>',
    )
    process.exit(2)
  }

  let expected
  const packagesFlag = args.find((a) => a.startsWith('--packages='))
  if (packagesFlag) {
    expected = parsePackagesFlag(packagesFlag.slice('--packages='.length))
  } else {
    const logPath = args[0]
    const text = readFileSync(logPath, 'utf8')
    expected = parseChangesetsLog(text)
  }

  if (expected.length === 0) {
    console.log('No packages reported published — nothing to verify.')
    return
  }

  console.log(`Verifying ${expected.length} package(s) on ${REGISTRY}...`)
  const missing = []
  for (const pkg of expected) {
    const ok = await checkOne(pkg.name, pkg.version)
    if (ok) {
      console.log(`  ok   ${pkg.name}@${pkg.version}`)
    } else {
      console.log(`  MISS ${pkg.name}@${pkg.version}`)
      missing.push(pkg)
    }
  }

  if (missing.length > 0) {
    console.error(
      `\nVerification failed: ${missing.length}/${expected.length} package(s) not on registry after ${
        (MAX_ATTEMPTS * RETRY_MS) / 1000
      }s:`,
    )
    for (const pkg of missing) console.error(`  - ${pkg.name}@${pkg.version}`)
    console.error(
      '\nChangesets reported these as published, but the registry says otherwise.',
    )
    console.error(
      'Likely causes: token lacks create-package permission, org package-creation restrictions, or an npm outage. Investigate before merging.',
    )
    process.exit(1)
  }

  console.log(`\nAll ${expected.length} package(s) verified on npm.`)
}

main().catch((err) => {
  console.error('verify-npm-publishes crashed:', err)
  process.exit(2)
})
