#!/usr/bin/env node
/**
 * Post-publish verification — closes the gap between what Changesets
 * reports and what is actually on the npm registry.
 *
 * `changesets/cli` calls `npm publish` under the hood and trusts the
 * exit code. But npm has been observed to exit 0 even when the backend
 * refused to create a brand-new scoped package name (granular-token
 * scope, org "restrict package creation" settings, 2FA requirements on
 * first create, etc.) — and because Changesets swallows npm's stderr on
 * success, the signal never surfaces in the workflow log.
 *
 * npm has also been observed to ack a publish and commit the version
 * document minutes later. Preview runs on 2026-09-06 (commits
 * `11dbbe60` and `e3e54669`) published seven siblings in the same
 * second while `@solvapay/init` landed 1–3 minutes later; the old
 * per-package 50s poll window gave up before the write was visible.
 *
 * We therefore run this script after every publish step:
 *
 *   1. Parse the list of packages Changesets claimed to publish —
 *      either from the raw publish log (preview workflow, which uses
 *      `pnpm changeset publish` directly) or from the JSON emitted by
 *      `changesets/action@v1` (stable workflow).
 *   2. For each `name@version`, poll the abbreviated packument on
 *      `registry.npmjs.org` until the exact version entry appears
 *      (round-based retries with a 10-minute global deadline cover
 *      slow npm write lag; fail fast after ~60s when the package name
 *      itself 404s).
 *   3. For stable releases (no SemVer pre-release identifier on the
 *      published version), inspect the manifest's `dependencies` and
 *      `peerDependencies` and reject any entry whose `@solvapay/*`
 *      reference resolves to a pre-release version. This catches the
 *      April-2026 regression where `pnpm publish` substituted leftover
 *      `1.0.8-preview.10` strings into every freshly-published
 *      sibling's manifest.
 *   4. Exit non-zero if any package is still missing or has poisoned
 *      dep references, with a clear summary so CI fails loud.
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
const PACKUMENT_ACCEPT = 'application/vnd.npm.install-v1+json'
const DEADLINE_MS = 10 * 60_000
const NAME_MISSING_FAIL_MS = 60_000
const BACKOFF_MS = [10_000, 20_000, 30_000, 60_000]

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

function encodePackageName(name) {
  return encodeURIComponent(name)
}

function formatElapsed(ms) {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) return `${seconds}s`
  return `${minutes}m${String(seconds).padStart(2, '0')}s`
}

/**
 * Query the abbreviated packument for `name` and return a tri-state:
 *   - `{ kind: 'found', manifest }` — version entry present
 *   - `{ kind: 'version-missing' }` — name exists, version not yet committed
 *   - `{ kind: 'name-missing' }` — package name not on registry (404)
 *   - `{ kind: 'transient-error', message }` — retry
 */
async function probePackument(name, version) {
  const url = `${REGISTRY}/${encodePackageName(name)}`
  try {
    const res = await fetch(url, { headers: { accept: PACKUMENT_ACCEPT } })
    if (res.status === 404) return { kind: 'name-missing' }
    if (!res.ok) {
      return {
        kind: 'transient-error',
        message: `unexpected ${res.status}`,
      }
    }
    const packument = await res.json()
    const manifest = packument?.versions?.[version]
    if (manifest) return { kind: 'found', manifest }
    return { kind: 'version-missing' }
  } catch (err) {
    return {
      kind: 'transient-error',
      message: err instanceof Error ? err.message : String(err),
    }
  }
}

function backoffForRound(roundIndex) {
  if (roundIndex < BACKOFF_MS.length) return BACKOFF_MS[roundIndex]
  return BACKOFF_MS[BACKOFF_MS.length - 1]
}

const PRERELEASE_RE = /-(?:preview|canary|rc|alpha|beta|next|snapshot)\b/i

function isPrereleaseVersion(version) {
  return PRERELEASE_RE.test(version)
}

/**
 * Walk a manifest's `dependencies` and `peerDependencies` and return any
 * `@solvapay/*` (or `solvapay`) reference that resolves to a pre-release
 * version. We only flag intra-org references because external packages
 * may legitimately track pre-release tracks.
 */
function findPrereleaseDepRefs(manifest) {
  const offenders = []
  const fields = ['dependencies', 'peerDependencies']
  for (const field of fields) {
    const deps = manifest[field]
    if (!deps || typeof deps !== 'object') continue
    for (const [depName, range] of Object.entries(deps)) {
      if (typeof range !== 'string') continue
      if (depName !== 'solvapay' && !depName.startsWith('@solvapay/')) continue
      if (isPrereleaseVersion(range)) {
        offenders.push({ field, depName, range })
      }
    }
  }
  return offenders
}

function reportOk(pkg, manifest) {
  if (isPrereleaseVersion(pkg.version)) {
    console.log(`  ok   ${pkg.name}@${pkg.version}  (pre-release; dep check skipped)`)
    return { ok: true }
  }

  const badRefs = findPrereleaseDepRefs(manifest)
  if (badRefs.length === 0) {
    console.log(`  ok   ${pkg.name}@${pkg.version}`)
    return { ok: true }
  }

  console.log(`  POISONED ${pkg.name}@${pkg.version}`)
  for (const ref of badRefs) {
    console.log(`           ${ref.field}.${ref.depName} = ${ref.range}`)
  }
  return { ok: false, refs: badRefs }
}

async function verifyPackages(expected) {
  const startedAt = Date.now()
  const pending = expected.map((pkg) => ({
    pkg,
    nameMissingSince: null,
    lastKind: null,
  }))
  const poisoned = []
  let round = 0

  while (pending.length > 0) {
    const elapsed = Date.now() - startedAt
    if (elapsed >= DEADLINE_MS) break

    round += 1
    const stillPending = []

    for (const entry of pending) {
      if (entry.failReason === 'name-missing') {
        stillPending.push(entry)
        continue
      }

      const { pkg } = entry
      const result = await probePackument(pkg.name, pkg.version)

      if (result.kind === 'found') {
        const report = reportOk(pkg, result.manifest)
        if (!report.ok) poisoned.push({ pkg, refs: report.refs })
        continue
      }

      if (result.kind === 'name-missing') {
        if (entry.nameMissingSince === null) {
          entry.nameMissingSince = Date.now()
        }
        entry.lastKind = 'name-missing'
        const nameMissingFor = Date.now() - entry.nameMissingSince
        if (nameMissingFor >= NAME_MISSING_FAIL_MS) {
          stillPending.push({ ...entry, failReason: 'name-missing' })
          continue
        }
      } else if (result.kind === 'version-missing') {
        entry.lastKind = 'version-missing'
      } else {
        entry.lastKind = 'transient-error'
        if (round === 1) {
          console.log(
            `  ${pkg.name}@${pkg.version}: ${result.message}, retrying...`,
          )
        }
      }

      stillPending.push(entry)
    }

    if (stillPending.length === 0) {
      pending.length = 0
      break
    }

    const elapsedAfterRound = Date.now() - startedAt
    if (elapsedAfterRound >= DEADLINE_MS) {
      pending.splice(0, pending.length, ...stillPending)
      break
    }

    for (const entry of stillPending) {
      if (entry.failReason === 'name-missing') continue
      const label =
        entry.lastKind === 'version-missing'
          ? 'version not on registry yet'
          : entry.lastKind === 'name-missing'
            ? 'package name not on registry yet'
            : 'registry probe retry'
      console.log(
        `  waiting on ${entry.pkg.name}@${entry.pkg.version} (${label}; ${formatElapsed(elapsedAfterRound)} elapsed)`,
      )
    }

    pending.splice(0, pending.length, ...stillPending)

    const hasRetryable = pending.some((entry) => entry.failReason !== 'name-missing')
    if (!hasRetryable) break

    const waitMs = backoffForRound(round - 1)
    const remaining = DEADLINE_MS - (Date.now() - startedAt)
    if (remaining <= 0) break
    await sleep(Math.min(waitMs, remaining))
  }

  const elapsed = Date.now() - startedAt
  const missingNames = pending.filter((entry) => entry.failReason === 'name-missing')
  const missingVersions = pending.filter((entry) => entry.failReason !== 'name-missing')

  for (const entry of missingVersions) {
    console.log(`  MISS ${entry.pkg.name}@${entry.pkg.version}`)
  }
  for (const entry of missingNames) {
    console.log(`  MISS ${entry.pkg.name}@${entry.pkg.version}  (package name not on registry)`)
  }

  return {
    elapsed,
    missingNames: missingNames.map((entry) => entry.pkg),
    missingVersions: missingVersions.map((entry) => entry.pkg),
    poisoned,
  }
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
  const { elapsed, missingNames, missingVersions, poisoned } =
    await verifyPackages(expected)

  const missingCount = missingNames.length + missingVersions.length
  if (missingCount > 0) {
    console.error(
      `\nVerification failed: ${missingCount}/${expected.length} package(s) not on registry after ${formatElapsed(elapsed)}:`,
    )
    for (const pkg of [...missingNames, ...missingVersions]) {
      console.error(`  - ${pkg.name}@${pkg.version}`)
    }
    console.error(
      '\nChangesets reported these as published, but the registry says otherwise.',
    )

    if (missingNames.length > 0) {
      console.error(
        '\nPackage name(s) absent from the registry — likely causes:',
      )
      console.error(
        '  - publish token lacks permission to create a new scoped package',
      )
      console.error(
        '  - npm org "restrict package creation" settings block the name',
      )
      console.error(
        '  - first-publish 2FA or org policy blocked package creation',
      )
    }

    if (missingVersions.length > 0) {
      console.error(
        '\nPackage name(s) exist but the version never appeared — likely causes:',
      )
      console.error(
        '  - npm write/replication lag (npm acked the publish but committed the version document later)',
      )
      console.error(
        '  - npm silently refused the version publish while exiting 0',
      )
      console.error('  - re-run the publish workflow once npm catches up')
    }

    process.exit(1)
  }

  if (poisoned.length > 0) {
    console.error(
      `\nVerification failed: ${poisoned.length}/${expected.length} stable package(s) declare pre-release SolvaPay deps:`,
    )
    for (const { pkg, refs } of poisoned) {
      console.error(`  - ${pkg.name}@${pkg.version}`)
      for (const ref of refs) {
        console.error(`      ${ref.field}.${ref.depName} = ${ref.range}`)
      }
    }
    console.error(
      '\nStable releases must not pin to pre-release versions of sibling',
    )
    console.error(
      'packages — installers will resolve a non-`@latest` build. This',
    )
    console.error(
      'usually means a workspace `package.json` carried a pre-release',
    )
    console.error(
      '`version` string when `pnpm publish` substituted `workspace:*`',
    )
    console.error(
      'references. Reset the offending package to a stable version and',
    )
    console.error('cut a follow-up release.')
    process.exit(1)
  }

  console.log(`\nAll ${expected.length} package(s) verified on npm (${formatElapsed(elapsed)}).`)
}

main().catch((err) => {
  console.error('verify-npm-publishes crashed:', err)
  process.exit(2)
})
