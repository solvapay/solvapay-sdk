#!/usr/bin/env tsx

import { execSync, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type ListedDependency = {
  version?: string
}

type ListedPackage = {
  name: string
  path: string
  problems?: string[]
  dependencies?: Record<string, ListedDependency>
  devDependencies?: Record<string, ListedDependency>
  optionalDependencies?: Record<string, ListedDependency>
}

const CRITICAL_LIBRARIES = ['react', 'react-dom', 'vite', 'vitest', '@types/react']
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '..')

// NOTE: cross-package version drift is no longer enforced here — since the
// Changesets migration (PR #127) each `@solvapay/*` publishable package is
// versioned independently. The runtime adapters (`@solvapay/mcp-core`,
// `@solvapay/mcp` — now a single package with `./fetch` + `./express`
// subpath exports) live on their own `0.x` track; `@solvapay/react` /
// `@solvapay/react-supabase` are on their own `1.x` track; `@solvapay/fetch`
// has its own lineage starting at `1.0.0` (carried over from the
// `@solvapay/supabase@1.0.1` body). What we still care about is **inside
// a single install graph** — the checks below catch pnpm peer-dep
// regressions and cross-workspace prerelease drift that would break the
// local install tree.

const runRecursiveList = (): ListedPackage[] => {
  const stdout = execSync('pnpm -r ls --depth 0 --json', {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  return JSON.parse(stdout) as ListedPackage[]
}

const parseMajor = (rawVersion: string | undefined): number | null => {
  if (!rawVersion || rawVersion.startsWith('link:') || rawVersion.startsWith('workspace:')) {
    return null
  }

  const match = rawVersion.match(/^(\d+)\./)
  if (!match) {
    return null
  }

  return Number(match[1])
}

const collectDependencyGroups = (pkg: ListedPackage): Array<Record<string, ListedDependency>> => [
  pkg.dependencies || {},
  pkg.devDependencies || {},
  pkg.optionalDependencies || {},
]

const findPeerProblems = (packages: ListedPackage[]): string[] =>
  packages.flatMap(pkg => (pkg.problems || []).map(problem => `${pkg.name}: ${problem}`))

const probePeerWarningsWithFrozenInstall = (): string[] => {
  const installProbe = spawnSync('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
  })

  const combinedOutput = `${installProbe.stdout || ''}\n${installProbe.stderr || ''}`
  const hasPeerWarnings = combinedOutput.includes('Issues with peer dependencies found')

  if (installProbe.status !== 0) {
    const trimmedOutput = combinedOutput
      .trim()
      .split('\n')
      .slice(-12)
      .join('\n')
    return [
      `Unable to probe peer dependencies with frozen install (exit ${installProbe.status ?? 'unknown'}).\n${trimmedOutput}`,
    ]
  }

  if (!hasPeerWarnings) {
    return []
  }

  const warningLines = combinedOutput
    .split('\n')
    .filter(line => line.includes('Issues with peer dependencies found') || line.includes('✕ unmet peer'))

  if (warningLines.length === 0) {
    return ['pnpm reported peer dependency issues during frozen install']
  }

  return warningLines
}

const findCriticalMajorDrift = (packages: ListedPackage[]): string[] => {
  const byLibrary = new Map<string, Map<number, Set<string>>>()

  for (const pkg of packages) {
    for (const dependencyGroup of collectDependencyGroups(pkg)) {
      for (const [dependencyName, dependencyInfo] of Object.entries(dependencyGroup)) {
        if (!CRITICAL_LIBRARIES.includes(dependencyName)) {
          continue
        }

        const major = parseMajor(dependencyInfo.version)
        if (major === null) {
          continue
        }

        if (!byLibrary.has(dependencyName)) {
          byLibrary.set(dependencyName, new Map())
        }

        const majors = byLibrary.get(dependencyName)!
        if (!majors.has(major)) {
          majors.set(major, new Set())
        }
        majors.get(major)!.add(pkg.name)
      }
    }
  }

  const issues: string[] = []
  for (const [library, majorMap] of byLibrary.entries()) {
    if (majorMap.size <= 1) {
      continue
    }

    const details = [...majorMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([major, packagesUsingMajor]) => `v${major} (${[...packagesUsingMajor].sort().join(', ')})`)
      .join(' vs ')

    issues.push(`${library}: ${details}`)
  }

  return issues
}

const findSolvaPayPrereleaseDrift = (packages: ListedPackage[]): string[] => {
  const prereleaseVersionUsers = new Map<string, Set<string>>()

  for (const pkg of packages) {
    for (const dependencyGroup of collectDependencyGroups(pkg)) {
      for (const [dependencyName, dependencyInfo] of Object.entries(dependencyGroup)) {
        if (!dependencyName.startsWith('@solvapay/')) {
          continue
        }

        const version = dependencyInfo.version
        if (!version || version.startsWith('link:') || version.startsWith('workspace:')) {
          continue
        }
        if (!version.includes('-')) {
          continue
        }

        if (!prereleaseVersionUsers.has(version)) {
          prereleaseVersionUsers.set(version, new Set())
        }
        prereleaseVersionUsers.get(version)!.add(`${pkg.name} -> ${dependencyName}`)
      }
    }
  }

  if (prereleaseVersionUsers.size <= 1) {
    return []
  }

  return [...prereleaseVersionUsers.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([prereleaseVersion, users]) => `${prereleaseVersion}: ${[...users].sort().join(', ')}`)
}

const printIssueBlock = (title: string, issues: string[]) => {
  if (issues.length === 0) {
    return
  }

  console.error(`\n${title}`)
  for (const issue of issues) {
    console.error(`- ${issue}`)
  }
}

const main = () => {
  console.log('Checking dependency health...')

  const packages = runRecursiveList()
  const peerProblems = findPeerProblems(packages)
  const peerWarningsFromInstall = probePeerWarningsWithFrozenInstall()
  const criticalMajorDrift = findCriticalMajorDrift(packages)
  const prereleaseVersionDrift = findSolvaPayPrereleaseDrift(packages)

  printIssueBlock('Peer dependency problems:', peerProblems)
  printIssueBlock('Peer dependency warnings from frozen install:', peerWarningsFromInstall)
  printIssueBlock('Critical dependency major drift:', criticalMajorDrift)
  printIssueBlock('Mixed @solvapay/* prerelease dependency versions:', prereleaseVersionDrift)

  const hasIssues =
    peerProblems.length > 0 ||
    peerWarningsFromInstall.length > 0 ||
    criticalMajorDrift.length > 0 ||
    prereleaseVersionDrift.length > 0

  if (hasIssues) {
    console.error('\nDependency health check failed.')
    process.exit(1)
  }

  console.log('Dependency health check passed.')
}

main()
