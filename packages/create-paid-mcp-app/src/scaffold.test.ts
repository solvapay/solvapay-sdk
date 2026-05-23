import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyOverlay,
  assertTargetDirAbsent,
  BASE_TEMPLATE_DIR,
  copyDir,
  PLACEHOLDERS,
  substitute,
} from './scaffold'

const makeTempDir = (): Promise<string> => mkdtemp(path.join(os.tmpdir(), 'create-paid-mcp-app-'))

describe('substitute', () => {
  it('replaces every occurrence in the table', () => {
    const out = substitute('hello __NAME__, ref __NAME__', new Map([['__NAME__', 'world']]))
    expect(out).toBe('hello world, ref world')
  })
})

describe('assertTargetDirAbsent', () => {
  it('passes for a non-existent path', async () => {
    const cwd = await makeTempDir()
    try {
      await expect(assertTargetDirAbsent(path.join(cwd, 'nope'))).resolves.toBeUndefined()
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('passes for an empty directory', async () => {
    const cwd = await makeTempDir()
    try {
      await expect(assertTargetDirAbsent(cwd)).resolves.toBeUndefined()
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('throws for a non-empty directory', async () => {
    const cwd = await makeTempDir()
    try {
      await writeFile(path.join(cwd, 'occupied.txt'), 'x', 'utf8')
      await expect(assertTargetDirAbsent(cwd)).rejects.toThrow(/non-empty/)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})

describe('copyDir + applyOverlay (round-trip)', () => {
  let target: string

  beforeEach(async () => {
    target = await makeTempDir()
    // start empty so assertTargetDirAbsent would pass
    await rm(target, { recursive: true, force: true })
  })

  afterEach(async () => {
    await rm(target, { recursive: true, force: true })
  })

  it('copies the _base/ template tree and substitutes placeholders', async () => {
    const substitutions = new Map<string, string>([
      [PLACEHOLDERS.WORKER_NAME, 'demo-mcp'],
      [PLACEHOLDERS.RESOURCE_URI_SLUG, 'demo-mcp'],
      [PLACEHOLDERS.PRODUCT_REF, 'prd_test_123'],
      [PLACEHOLDERS.PUBLIC_BASE_URL, 'http://localhost:8787'],
    ])
    await copyDir(BASE_TEMPLATE_DIR, target, { substitutions })

    const pkg = JSON.parse(await readFile(path.join(target, 'package.json'), 'utf8')) as {
      name: string
    }
    expect(pkg.name).toBe('demo-mcp')

    const worker = await readFile(path.join(target, 'src', 'worker.ts'), 'utf8')
    expect(worker).toContain("'ui://demo-mcp/mcp-app.html'")

    const envExample = await readFile(path.join(target, '.env.example'), 'utf8')
    expect(envExample).toContain('SOLVAPAY_PRODUCT_REF=prd_test_123')
    // UPSTREAM_API_KEY block should NOT be in _base — it lives in the
    // from-openapi overlay.
    expect(envExample).not.toContain('UPSTREAM_API_KEY')
  })

  it('appends overlay payloads onto matching base files', async () => {
    await mkdir(target, { recursive: true })
    await writeFile(path.join(target, '.env.example'), 'BASE=1\n', 'utf8')
    await writeFile(path.join(target, 'README.md'), 'Hello\n', 'utf8')

    const overlay = await makeTempDir()
    try {
      await writeFile(path.join(overlay, '.env.example.append'), 'EXTRA=2\n', 'utf8')
      await writeFile(path.join(overlay, 'README.append.md'), 'World\n', 'utf8')
      await applyOverlay(overlay, target)

      const env = await readFile(path.join(target, '.env.example'), 'utf8')
      expect(env).toContain('BASE=1')
      expect(env).toContain('EXTRA=2')

      const readme = await readFile(path.join(target, 'README.md'), 'utf8')
      expect(readme).toContain('Hello')
      expect(readme).toContain('World')
    } finally {
      await rm(overlay, { recursive: true, force: true })
    }
  })

  it('honors renameMap when applying an overlay', async () => {
    await mkdir(path.join(target, 'src', 'tools'), { recursive: true })
    const overlay = await makeTempDir()
    try {
      await mkdir(path.join(overlay, 'src', 'tools'), { recursive: true })
      await writeFile(
        path.join(overlay, 'src', 'tools', '_placeholder.ts'),
        'export const id = "__TOOL_NAME__"\n',
        'utf8',
      )
      await applyOverlay(overlay, target, {
        substitutions: new Map([[PLACEHOLDERS.TOOL_NAME, 'fetchPet']]),
        renameMap: new Map([
          ['src/tools/_placeholder.ts', 'src/tools/fetchPet.ts'],
        ]),
      })
      const written = await readFile(
        path.join(target, 'src', 'tools', 'fetchPet.ts'),
        'utf8',
      )
      expect(written).toContain('export const id = "fetchPet"')
    } finally {
      await rm(overlay, { recursive: true, force: true })
    }
  })
})
