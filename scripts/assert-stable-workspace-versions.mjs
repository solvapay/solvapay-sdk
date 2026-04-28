#!/usr/bin/env node
/**
 * Pre-publish gate — fail loud if any non-`private`, non-ignored workspace
 * package carries a SemVer pre-release identifier in its `version` field.
 *
 * Why this exists:
 *
 * `pnpm publish` substitutes `workspace:*`, `workspace:^`, and `workspace:~`
 * dependency references with the literal version string of the dependency
 * at publish time. If a sibling's `version` is something like
 * `1.0.8-preview.10` (e.g. left over from a snapshot/preview workflow that
 * never reset its bumps), every freshly-published package will declare a
 * dependency on that pre-release version — a hard pin to a non-`@latest`
 * tag — and stable consumers will silently start pulling pre-release
 * builds.
 *
 * This regressed once already (April 2026) when `@solvapay/core`,
 * `@solvapay/auth`, and the `solvapay` CLI sat at `1.0.8-preview.10` on
 * `main` while `@solvapay/server@1.0.9`, `@solvapay/next@1.0.8`,
 * `@solvapay/mcp-core@0.2.1`, and `@solvapay/mcp@0.2.1` all got published
 * with their workspace dep references pinned to that preview string.
 *
 * Wired into `.github/workflows/publish.yml` before `changesets/action` so
 * we never hand `pnpm publish` a workspace in that state again.
 *
 * Exits 0 when every relevant package has a stable version; exits 1 with
 * a list of offenders otherwise.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const PACKAGES_DIR = join(ROOT, 'packages')

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function listPackageJsons() {
  const entries = readdirSync(PACKAGES_DIR, { withFileTypes: true })
  const out = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const pkgPath = join(PACKAGES_DIR, entry.name, 'package.json')
    try {
      if (statSync(pkgPath).isFile()) out.push(pkgPath)
    } catch {
      // No package.json in this directory — skip.
    }
  }
  return out
}

function isIgnored(pkg, changesetIgnore) {
  if (pkg.private === true) return true
  for (const pattern of changesetIgnore) {
    if (pattern.endsWith('/*')) {
      const scope = pattern.slice(0, -2)
      if (pkg.name?.startsWith(`${scope}/`)) return true
    } else if (pkg.name === pattern) {
      return true
    }
  }
  return false
}

const PRERELEASE_RE = /-(?:preview|canary|rc|alpha|beta|next|snapshot)\b/i

function main() {
  const changesetConfig = readJson(join(ROOT, '.changeset', 'config.json'))
  const changesetIgnore = Array.isArray(changesetConfig.ignore) ? changesetConfig.ignore : []

  const offenders = []
  for (const pkgPath of listPackageJsons()) {
    const pkg = readJson(pkgPath)
    if (!pkg.name || !pkg.version) continue
    if (isIgnored(pkg, changesetIgnore)) continue
    if (PRERELEASE_RE.test(pkg.version)) {
      offenders.push({ name: pkg.name, version: pkg.version, path: pkgPath })
    }
  }

  if (offenders.length === 0) {
    console.log('All publishable workspace packages have stable versions.')
    return
  }

  console.error('Workspace contains pre-release versions on a stable branch:')
  for (const off of offenders) {
    const rel = off.path.replace(`${ROOT}/`, '')
    console.error(`  - ${off.name}@${off.version}  (${rel})`)
  }
  console.error('')
  console.error(
    'pnpm publish would substitute these strings into every dependent\n' +
      'package\'s `dependencies` / `peerDependencies`, pinning stable\n' +
      'releases to a pre-release tag. Reset these to the last published\n' +
      'stable version (or add a changeset to bump them) before merging.',
  )
  process.exit(1)
}

main()
