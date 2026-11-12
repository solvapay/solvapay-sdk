/**
 * Are a project's `@solvapay/*` packages current? `solvapay doctor` runs this
 * so a project scaffolded, or copied, weeks ago shows that its SDK is behind
 * before anyone deploys it or reports a bug that is already fixed.
 *
 * - The installed version comes from `node_modules/<name>/package.json`, not
 *   the range in package.json: `^0.4.3` never installs 0.5.0.
 * - A stable version is compared with npm's `latest`; a preview build
 *   (`…-preview-<sha>`) with npm's `preview` tag.
 * - A declared package that isn't installed, or a registry lookup that
 *   fails, throws.
 *
 * Scaffolded MCP projects carry the same check in
 * `scripts/lib/sdk-versions.mjs`, run by their deploy script.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { PackageManager } from './project'

const REGISTRY = 'https://registry.npmjs.org'

export type DistTags = Record<string, string | undefined>
export type FetchDistTags = (name: string) => Promise<DistTags>

export type OutdatedPackage = {
  name: string
  installed: string
  wanted: string
  tag: 'latest' | 'preview'
}

const readJson = async (file: string): Promise<Record<string, unknown> | null> => {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/** `@solvapay/*` names in dependencies and devDependencies, or `null` without a package.json. */
export const solvapayDependencies = async (cwd: string): Promise<string[] | null> => {
  const pkg = await readJson(path.join(cwd, 'package.json'))
  if (!pkg) return null
  const names = new Set([
    ...Object.keys((pkg.dependencies as Record<string, string> | undefined) ?? {}),
    ...Object.keys((pkg.devDependencies as Record<string, string> | undefined) ?? {}),
  ])
  return [...names].filter(name => name.startsWith('@solvapay/')).sort()
}

export const fetchDistTags: FetchDistTags = async name => {
  const url = `${REGISTRY}/-/package/${name}/dist-tags`
  let response: Response
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error) {
    throw new Error(
      `Could not reach ${url}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return (await response.json()) as DistTags
}

const isPreview = (version: string): boolean => version.includes('-')

/** -1, 0 or 1 for two plain `x.y.z` versions. */
export const compareStable = (a: string, b: string): number => {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/** Each declared `@solvapay/*` package whose installed version is behind npm. */
export const findOutdatedSolvapayPackages = async (
  cwd: string,
  names: string[],
  distTags: FetchDistTags = fetchDistTags,
): Promise<OutdatedPackage[]> => {
  const outdated: OutdatedPackage[] = []
  for (const name of names) {
    const installedPkg = await readJson(
      path.join(cwd, 'node_modules', ...name.split('/'), 'package.json'),
    )
    if (!installedPkg || typeof installedPkg.version !== 'string') {
      throw new Error(
        `${name} is in package.json but not installed. Run your package manager's install first.`,
      )
    }
    const installed = installedPkg.version
    const tag = isPreview(installed) ? 'preview' : 'latest'
    const wanted = (await distTags(name))[tag]
    if (typeof wanted !== 'string') throw new Error(`npm has no '${tag}' tag for ${name}`)
    const behind = isPreview(installed)
      ? installed !== wanted
      : compareStable(installed, wanted) < 0
    if (behind) outdated.push({ name, installed, wanted, tag })
  }
  return outdated
}

/** The install command that pins each package exactly, for the project's package manager. */
export const upgradeCommand = (
  packageManager: PackageManager,
  outdated: OutdatedPackage[],
): string => {
  const specs = outdated.map(o => `${o.name}@${o.wanted}`).join(' ')
  if (packageManager === 'pnpm') return `pnpm add --save-exact ${specs}`
  if (packageManager === 'yarn') return `yarn add --exact ${specs}`
  return `npm install --save-exact ${specs}`
}
