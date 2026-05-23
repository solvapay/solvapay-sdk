import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyOverlay,
  assertTargetDirAbsent,
  BASE_TEMPLATE_DIR,
  copyDir,
  deriveServerName,
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

describe('deriveServerName', () => {
  it('lowercases and slugifies a normal project name', () => {
    expect(deriveServerName('My Petstore MCP')).toBe('my-petstore-mcp')
  })

  it('keeps existing dash-separated slugs', () => {
    expect(deriveServerName('petstore-mcp')).toBe('petstore-mcp')
  })

  it('strips punctuation but keeps digits', () => {
    expect(deriveServerName('My_App@2')).toBe('my-app2')
  })

  it('collapses runs of dashes and trims leading/trailing dashes', () => {
    expect(deriveServerName('--my---app--')).toBe('my-app')
  })

  it('falls back to the SDK default when input slugifies to empty', () => {
    expect(deriveServerName('!!!')).toBe('solvapay-mcp-server')
    expect(deriveServerName('')).toBe('solvapay-mcp-server')
  })
})

describe('templates/_base/scripts/dev.mjs', () => {
  it('exists and is wired into npm run dev', async () => {
    const pkgRaw = await readFile(path.join(BASE_TEMPLATE_DIR, 'package.json'), 'utf8')
    const pkg = JSON.parse(pkgRaw) as { scripts: Record<string, string> }
    expect(pkg.scripts.dev).toContain('scripts/dev.mjs')
    expect(pkg.scripts['dev:widget']).toContain('vite build --watch')

    const dev = await readFile(path.join(BASE_TEMPLATE_DIR, 'scripts', 'dev.mjs'), 'utf8')
    expect(dev).toContain("'wrangler'")
    expect(dev).toContain('vite')
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
      [PLACEHOLDERS.SERVER_NAME, 'demo-mcp'],
      [PLACEHOLDERS.PRODUCT_REF, 'prd_test_123'],
      [PLACEHOLDERS.PUBLIC_BASE_URL, 'http://localhost:8787'],
    ])
    await copyDir(BASE_TEMPLATE_DIR, target, { substitutions })

    const pkg = JSON.parse(await readFile(path.join(target, 'package.json'), 'utf8')) as {
      name: string
      scripts: Record<string, string>
    }
    expect(pkg.name).toBe('demo-mcp')
    expect(pkg.scripts.dev).toContain('scripts/dev.mjs')

    const worker = await readFile(path.join(target, 'src', 'worker.ts'), 'utf8')
    expect(worker).toContain("'ui://demo-mcp/mcp-app.html'")
    expect(worker).toContain("serverName: 'demo-mcp'")

    const envExample = await readFile(path.join(target, '.env.example'), 'utf8')
    expect(envExample).toContain('SOLVAPAY_PRODUCT_REF=prd_test_123')
    expect(envExample).not.toContain('UPSTREAM_API_KEY')

    // dev.mjs should have copied into scripts/.
    const dev = await readFile(path.join(target, 'scripts', 'dev.mjs'), 'utf8')
    expect(dev).toContain('wrangler')
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
