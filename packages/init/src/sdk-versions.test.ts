import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  compareStable,
  findOutdatedSolvapayPackages,
  solvapayDependencies,
  upgradeCommand,
  type FetchDistTags,
} from './sdk-versions'

const dirs: string[] = []

/** A project declaring these packages, installed at the given versions (`null`: not installed). */
async function project(installed: Record<string, string | null>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'doctor-sdk-versions-'))
  dirs.push(root)
  const dependencies = Object.fromEntries(Object.keys(installed).map(name => [name, '^0.0.0']))
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ dependencies: { zod: '^4.0.0', ...dependencies } }),
  )
  for (const [name, version] of Object.entries(installed)) {
    if (version === null) continue
    const dir = path.join(root, 'node_modules', ...name.split('/'))
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name, version }))
  }
  return root
}

const distTags: FetchDistTags = async name =>
  ({
    '@solvapay/mcp': { latest: '0.5.0' },
    '@solvapay/server': { latest: '2.11.0' },
    '@solvapay/agents': { latest: '0.1.0-preview-old', preview: '0.1.0-preview-new' },
  })[name] ?? {}

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('sdk-versions', () => {
  it('lists only @solvapay/* dependencies, or null without a package.json', async () => {
    expect(await solvapayDependencies(await project({ '@solvapay/server': '2.11.0' }))).toEqual([
      '@solvapay/server',
    ])
    expect(await solvapayDependencies(path.join(os.tmpdir(), 'no-such-project-dir'))).toBeNull()
  })

  it('reports installed versions behind latest, and previews against the preview tag', async () => {
    const root = await project({
      '@solvapay/mcp': '0.4.3',
      '@solvapay/server': '2.11.0',
      '@solvapay/agents': '0.1.0-preview-mid',
    })
    const names = (await solvapayDependencies(root)) ?? []
    expect(await findOutdatedSolvapayPackages(root, names, distTags)).toEqual([
      {
        name: '@solvapay/agents',
        installed: '0.1.0-preview-mid',
        wanted: '0.1.0-preview-new',
        tag: 'preview',
      },
      { name: '@solvapay/mcp', installed: '0.4.3', wanted: '0.5.0', tag: 'latest' },
    ])
  })

  it('throws when a declared package is not installed', async () => {
    const root = await project({ '@solvapay/mcp': null })
    await expect(findOutdatedSolvapayPackages(root, ['@solvapay/mcp'], distTags)).rejects.toThrow(
      /not installed/,
    )
  })

  it('builds an exact-pin upgrade command per package manager', () => {
    const outdated = [
      { name: '@solvapay/mcp', installed: '0.4.3', wanted: '0.5.0', tag: 'latest' as const },
    ]
    expect(upgradeCommand('npm', outdated)).toBe('npm install --save-exact @solvapay/mcp@0.5.0')
    expect(upgradeCommand('pnpm', outdated)).toBe('pnpm add --save-exact @solvapay/mcp@0.5.0')
    expect(upgradeCommand('yarn', outdated)).toBe('yarn add --exact @solvapay/mcp@0.5.0')
  })

  it('orders versions numerically', () => {
    expect(compareStable('0.4.10', '0.5.0')).toBe(-1)
    expect(compareStable('2.11.0', '2.8.0')).toBe(1)
  })
})
