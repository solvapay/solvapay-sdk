/* global fetch, AbortSignal */
/**
 * Are this project's `@solvapay/*` packages current? `scripts/deploy.mjs`
 * runs this before every deploy, so a project that was scaffolded, or copied
 * from another project, weeks ago can't ship an SDK that has since been
 * fixed. `--allow-outdated` skips the check on purpose.
 *
 * - The installed version comes from `node_modules/<name>/package.json`, not
 *   the range in package.json: `^0.4.3` never installs 0.5.0.
 * - A stable version is compared with npm's `latest`; a preview build
 *   (`…-preview-<sha>`) with npm's `preview` tag.
 * - A package that isn't installed, or a registry lookup that fails, throws.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const REGISTRY = 'https://registry.npmjs.org'

/** `@solvapay/*` names in dependencies and devDependencies. */
export function solvapayDependencies(projectRoot) {
  const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
  const names = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ])
  return [...names].filter(name => name.startsWith('@solvapay/')).sort()
}

export function installedVersion(projectRoot, name) {
  const path = join(projectRoot, 'node_modules', ...name.split('/'), 'package.json')
  if (!existsSync(path)) {
    throw new Error(
      `${name} is in package.json but not installed. Run your package manager's install first.`,
    )
  }
  return JSON.parse(readFileSync(path, 'utf8')).version
}

export async function fetchDistTags(name) {
  const url = `${REGISTRY}/-/package/${name}/dist-tags`
  let response
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
  return response.json()
}

const isPreview = version => version.includes('-')

/** -1, 0 or 1 for two plain `x.y.z` versions. */
export function compareStable(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0) ? -1 : 1
  }
  return 0
}

/** Each `@solvapay/*` package whose installed version is behind npm, with the version to move to. */
export async function findOutdatedSolvapayPackages(projectRoot, { distTags = fetchDistTags } = {}) {
  const outdated = []
  for (const name of solvapayDependencies(projectRoot)) {
    const installed = installedVersion(projectRoot, name)
    const tags = await distTags(name)
    const tag = isPreview(installed) ? 'preview' : 'latest'
    const wanted = tags[tag]
    if (typeof wanted !== 'string') throw new Error(`npm has no '${tag}' tag for ${name}`)
    const behind = isPreview(installed)
      ? installed !== wanted
      : compareStable(installed, wanted) < 0
    if (behind) outdated.push({ name, installed, wanted, tag })
  }
  return outdated
}

/** The install command for the project's package manager, pinning exact versions. */
export function upgradeCommand(projectRoot, outdated) {
  const specs = outdated.map(o => `${o.name}@${o.wanted}`).join(' ')
  if (existsSync(join(projectRoot, 'pnpm-lock.yaml'))) return `pnpm add --save-exact ${specs}`
  if (existsSync(join(projectRoot, 'yarn.lock'))) return `yarn add --exact ${specs}`
  if (existsSync(join(projectRoot, 'bun.lock')) || existsSync(join(projectRoot, 'bun.lockb')))
    return `bun add --exact ${specs}`
  return `npm install --save-exact ${specs}`
}
