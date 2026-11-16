import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { outdatedSolvapayMessage } from '../deploy.mjs'
import { compareStable, findOutdatedSolvapayPackages, upgradeCommand } from './sdk-versions.mjs'

const dirs = []

/** A project with these `@solvapay/*` packages declared and installed at the given versions. */
function project(installed, { lockfile } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sdk-versions-'))
  dirs.push(root)
  const dependencies = Object.fromEntries(Object.keys(installed).map(name => [name, '^0.0.0']))
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ dependencies: { zod: '^4.0.0', ...dependencies } }),
  )
  for (const [name, version] of Object.entries(installed)) {
    if (version === null) continue
    const dir = join(root, 'node_modules', ...name.split('/'))
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version }))
  }
  if (lockfile) writeFileSync(join(root, lockfile), '')
  return root
}

const tags = {
  '@solvapay/mcp': { latest: '0.5.0' },
  '@solvapay/server': { latest: '2.11.0' },
  '@solvapay/agents': { latest: '0.1.0-preview-old', preview: '0.1.0-preview-new' },
}
const distTags = async name => tags[name]

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('findOutdatedSolvapayPackages', () => {
  it('reports installed versions behind latest, ignoring the range in package.json', async () => {
    const root = project({ '@solvapay/mcp': '0.4.3', '@solvapay/server': '2.11.0' })
    expect(await findOutdatedSolvapayPackages(root, { distTags })).toEqual([
      { name: '@solvapay/mcp', installed: '0.4.3', wanted: '0.5.0', tag: 'latest' },
    ])
  })

  it('compares a preview build with the preview tag, not a stale latest', async () => {
    expect(
      await findOutdatedSolvapayPackages(project({ '@solvapay/agents': '0.1.0-preview-new' }), {
        distTags,
      }),
    ).toEqual([])
    expect(
      await findOutdatedSolvapayPackages(project({ '@solvapay/agents': '0.1.0-preview-mid' }), {
        distTags,
      }),
    ).toEqual([
      {
        name: '@solvapay/agents',
        installed: '0.1.0-preview-mid',
        wanted: '0.1.0-preview-new',
        tag: 'preview',
      },
    ])
  })

  it('throws when a declared package is not installed', async () => {
    await expect(
      findOutdatedSolvapayPackages(project({ '@solvapay/mcp': null }), { distTags }),
    ).rejects.toThrow(/not installed/)
  })

  it('passes a registry failure through', async () => {
    const failing = async () => {
      throw new Error('Could not reach the registry')
    }
    await expect(
      findOutdatedSolvapayPackages(project({ '@solvapay/mcp': '0.5.0' }), { distTags: failing }),
    ).rejects.toThrow(/Could not reach/)
  })
})

describe('upgradeCommand', () => {
  const outdated = [{ name: '@solvapay/mcp', installed: '0.4.3', wanted: '0.5.0', tag: 'latest' }]
  it('pins exact versions with the project package manager', () => {
    expect(upgradeCommand(project({}), outdated)).toBe(
      'npm install --save-exact @solvapay/mcp@0.5.0',
    )
    expect(upgradeCommand(project({}, { lockfile: 'pnpm-lock.yaml' }), outdated)).toBe(
      'pnpm add --save-exact @solvapay/mcp@0.5.0',
    )
    expect(upgradeCommand(project({}, { lockfile: 'yarn.lock' }), outdated)).toBe(
      'yarn add --exact @solvapay/mcp@0.5.0',
    )
  })
})

describe('compareStable', () => {
  it('orders versions numerically', () => {
    expect(compareStable('0.4.10', '0.5.0')).toBe(-1)
    expect(compareStable('2.11.0', '2.8.0')).toBe(1)
    expect(compareStable('1.2.3', '1.2.3')).toBe(0)
  })
})

describe('outdatedSolvapayMessage (deploy.mjs)', () => {
  it('names each package and the upgrade command, and is null when current', async () => {
    const message = await outdatedSolvapayMessage(project({ '@solvapay/mcp': '0.4.3' }), {
      distTags,
    })
    expect(message).toContain('@solvapay/mcp: installed 0.4.3, npm latest 0.5.0')
    expect(message).toContain('npm install --save-exact @solvapay/mcp@0.5.0')
    expect(message).toContain('--allow-outdated')
    expect(
      await outdatedSolvapayMessage(project({ '@solvapay/mcp': '0.5.0' }), { distTags }),
    ).toBeNull()
  })

  it('skips the check with allowOutdated', async () => {
    const neverCalled = async () => {
      throw new Error('should not look up versions')
    }
    expect(
      await outdatedSolvapayMessage(project({ '@solvapay/mcp': '0.4.3' }), {
        allowOutdated: true,
        distTags: neverCalled,
      }),
    ).toBeNull()
  })
})
