import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { findSolvapaySdkRoot, runFromScratch } from '../types/mcp/from-scratch'

const TS_SOLVAPAY_DEPS = [
  '@solvapay/mcp',
  '@solvapay/server',
  '@solvapay/react',
  '@solvapay/core',
  '@solvapay/server-wasm',
] as const

describe('findSolvapaySdkRoot', () => {
  it('finds the monorepo from a nested create-solvapay path', async () => {
    const root = await findSolvapaySdkRoot(path.join(process.cwd(), 'templates', 'mcp', 'python'))
    expect(root).toBeTruthy()
    expect(root?.endsWith('solvapay-sdk')).toBe(true)
  })

  it('returns undefined outside the monorepo', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'not-sdk-'))
    try {
      await mkdir(path.join(cwd, 'nested'), { recursive: true })
      await writeFile(path.join(cwd, 'nested', 'file.txt'), 'x', 'utf8')
      expect(await findSolvapaySdkRoot(path.join(cwd, 'nested'))).toBeUndefined()
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})

describe('runFromScratch --dev (ts lane)', () => {
  it('rewrites package.json to checkout path deps and stays offline', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'ts-dev-lane-'))
    const target = path.join(parent, 'my-mcp')
    try {
      await runFromScratch({
        target,
        projectName: 'my-mcp',
        // camelCase because tool-name validation lives upstream in the CLI
        // (see F5 / Phase 2.3); runFromScratch takes the resolved name as-is.
        toolName: 'generateHaiku',
        language: 'ts',
        options: { yes: true, dev: true },
        skipInstall: true,
        skipInit: true,
        dev: true,
      })

      const pkg = JSON.parse(await readFile(path.join(target, 'package.json'), 'utf8')) as {
        dependencies: Record<string, string>
      }
      // Every SolvaPay dep resolves from the checkout — never a bare semver.
      for (const name of TS_SOLVAPAY_DEPS) {
        expect(pkg.dependencies[name]).toMatch(/^(link|file):/)
      }
      // Paths land where repo-paths.yaml maps them.
      expect(pkg.dependencies['@solvapay/core']).toContain(path.join('sdks', 'typescript', 'core'))
      expect(pkg.dependencies['@solvapay/server-wasm']).toContain(path.join('sdks', 'wasm'))
      // The unpublished server-wasm never blocks the dev lane (F1).

      const toolSrc = await readFile(path.join(target, 'src', 'tools', 'generate_haiku.ts'), 'utf8')
      const placeholder = toolSrc.match(/description:\s*\n?\s*'([^']+)'/)
      expect(placeholder?.[1]).toBeTruthy()
      const named = [...(placeholder?.[1] ?? '').matchAll(/`([a-z][a-z0-9_]*)`/g)].map(m => m[1])
      const factoryRegistered = new Set(['account', 'activate_plan', 'generate_haiku'])
      for (const name of named) {
        expect(factoryRegistered.has(name), `placeholder names unregistered tool \`${name}\``).toBe(
          true,
        )
      }
      expect(placeholder?.[1]).toMatch(/`account`/)
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })
})
