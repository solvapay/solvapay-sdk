#!/usr/bin/env tsx

import { execSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
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

// Packages intentionally pinned outside the monorepo-wide major for a specific reason.
// Keep this list small and justify each entry.
const CRITICAL_DRIFT_ALLOWLIST = new Set<string>([
  // Mirrors Lovable's default stack (React 18 + Vite 5 + Tailwind v3). Intentional.
  'spa-checkout',
  // Demo app for the MCP App SDK which ships on Vite 8. Not part of the web checkout surface.
  '@example/mcp-time-app',
])

// Matches strict semver prerelease versions like `1.2.3-preview.1`. pnpm's recursive ls
// sometimes reports workspace-resolved dependencies with a bracketed peer tree (e.g.
// `file:packages/react(react@18.3.1)...`) which can contain `-` for packages like
// `react-dom`; this regex avoids false-flagging those as prereleases.
const SEMVER_PRERELEASE = /^\d+\.\d+\.\d+-[0-9A-Za-z.-]+$/
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '..')
const PACKAGES_DIR = path.resolve(ROOT_DIR, 'packages')

const readJsonFile = <T>(filePath: string): T => JSON.parse(readFileSync(filePath, 'utf8')) as T

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
    if (CRITICAL_DRIFT_ALLOWLIST.has(pkg.name)) {
      continue
    }
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
        if (!version || version.startsWith('link:') || version.startsWith('workspace:') || version.startsWith('file:')) {
          continue
        }
        if (!SEMVER_PRERELEASE.test(version)) {
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

const findPublishableVersionDrift = (): string[] => {
  const packageDirectories = readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)

  const versionToPackages = new Map<string, Set<string>>()

  for (const packageDirectory of packageDirectories) {
    const packageJsonPath = path.join(PACKAGES_DIR, packageDirectory, 'package.json')
    if (!existsSync(packageJsonPath)) {
      continue
    }
    const packageJson = readJsonFile<{ name: string; version?: string; private?: boolean }>(packageJsonPath)

    if (packageJson.private) {
      continue
    }
    if (!packageJson.version) {
      continue
    }
    if (!packageJson.name.startsWith('@solvapay/') && packageJson.name !== 'solvapay') {
      continue
    }

    if (!versionToPackages.has(packageJson.version)) {
      versionToPackages.set(packageJson.version, new Set())
    }
    versionToPackages.get(packageJson.version)!.add(packageJson.name)
  }

  if (versionToPackages.size <= 1) {
    return []
  }

  return [...versionToPackages.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([version, names]) => `${version}: ${[...names].sort().join(', ')}`)
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
  const publishableVersionDrift = findPublishableVersionDrift()

  printIssueBlock('Peer dependency problems:', peerProblems)
  printIssueBlock('Peer dependency warnings from frozen install:', peerWarningsFromInstall)
  printIssueBlock('Critical dependency major drift:', criticalMajorDrift)
  printIssueBlock('Mixed @solvapay/* prerelease dependency versions:', prereleaseVersionDrift)
  printIssueBlock('Publishable package version drift:', publishableVersionDrift)

  const hasIssues =
    peerProblems.length > 0 ||
    peerWarningsFromInstall.length > 0 ||
    criticalMajorDrift.length > 0 ||
    prereleaseVersionDrift.length > 0 ||
    publishableVersionDrift.length > 0

  if (hasIssues) {
    console.error('\nDependency health check failed.')
    process.exit(1)
  }

  console.log('Dependency health check passed.')
}

main()
