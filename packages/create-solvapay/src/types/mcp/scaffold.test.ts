import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyOverlay,
  assertTargetDirAbsent,
  BASE_TEMPLATE_DIR,
  copyDir,
  deriveServerName,
  patchSolvapayVersions,
  PLACEHOLDERS,
  resolveLatestSolvapayVersions,
  SOLVAPAY_RUNTIME_DEPS,
  substitute,
  writeBootstrapEnv,
} from './scaffold'

const makeTempDir = (): Promise<string> => mkdtemp(path.join(os.tmpdir(), 'create-solvapay-'))

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

describe('writeBootstrapEnv', () => {
  it('writes the minimal .env without SOLVAPAY_API_BASE_URL by default', async () => {
    const target = await makeTempDir()
    try {
      await writeBootstrapEnv(target, 'prd_abc')
      const content = await readFile(path.join(target, '.env'), 'utf8')
      expect(content).toContain('SOLVAPAY_PRODUCT_REF=prd_abc')
      expect(content).toContain('MCP_PUBLIC_BASE_URL=http://localhost:8787')
      expect(content).not.toContain('SOLVAPAY_API_BASE_URL=')
    } finally {
      await rm(target, { recursive: true, force: true })
    }
  })

  it('appends SOLVAPAY_API_BASE_URL=api-dev when dev is true', async () => {
    const target = await makeTempDir()
    try {
      await writeBootstrapEnv(target, 'prd_abc', { dev: true })
      const content = await readFile(path.join(target, '.env'), 'utf8')
      expect(content).toContain('SOLVAPAY_API_BASE_URL=https://api-dev.solvapay.com')
    } finally {
      await rm(target, { recursive: true, force: true })
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

describe('SOLVAPAY_RUNTIME_DEPS', () => {
  it('covers the three @solvapay/* runtime packages with non-empty fallbacks', () => {
    const names = SOLVAPAY_RUNTIME_DEPS.map(d => d.name).sort()
    expect(names).toEqual(['@solvapay/mcp', '@solvapay/react', '@solvapay/server'])
    for (const dep of SOLVAPAY_RUNTIME_DEPS) {
      expect(dep.fallback).toMatch(/^\d+\.\d+\.\d+/)
    }
  })

  it('fallbacks match the caret pins in templates/mcp/_base/package.json', async () => {
    const raw = await readFile(path.join(BASE_TEMPLATE_DIR, 'package.json'), 'utf8')
    const pkg = JSON.parse(raw) as { dependencies: Record<string, string> }
    for (const dep of SOLVAPAY_RUNTIME_DEPS) {
      const declared = pkg.dependencies[dep.name]
      expect(declared, `${dep.name} should be present in _base/package.json`).toBeDefined()
      // Template pin is `^<version>`; fallback drops the caret.
      expect(declared.replace(/^[~^]/, '')).toBe(dep.fallback)
    }
  })
})

describe('resolveLatestSolvapayVersions', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('returns registry-reported versions when fetch succeeds', async () => {
    const versions: Record<string, string> = {
      '@solvapay/mcp': '0.9.9',
      '@solvapay/server': '2.0.0',
      '@solvapay/react': '3.1.4',
    }
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      const name = decodeURIComponent(url.replace('https://registry.npmjs.org/', '').replace('/latest', ''))
      return new Response(JSON.stringify({ version: versions[name] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch

    const onResolve = vi.fn()
    const map = await resolveLatestSolvapayVersions(SOLVAPAY_RUNTIME_DEPS, { onResolve })

    expect(map.get('@solvapay/mcp')).toBe('0.9.9')
    expect(map.get('@solvapay/server')).toBe('2.0.0')
    expect(map.get('@solvapay/react')).toBe('3.1.4')
    expect(onResolve).toHaveBeenCalledTimes(SOLVAPAY_RUNTIME_DEPS.length)
    for (const call of onResolve.mock.calls) {
      expect(call[0].source).toBe('registry')
    }
  })

  it('falls back to hardcoded versions when fetch throws (offline)', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ENETUNREACH')
    }) as typeof fetch

    const onResolve = vi.fn()
    const map = await resolveLatestSolvapayVersions(SOLVAPAY_RUNTIME_DEPS, { onResolve })

    for (const dep of SOLVAPAY_RUNTIME_DEPS) {
      expect(map.get(dep.name)).toBe(dep.fallback)
    }
    for (const call of onResolve.mock.calls) {
      expect(call[0].source).toBe('fallback')
    }
  })

  it('falls back when the registry returns a non-2xx response', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('not found', { status: 404 }),
    ) as typeof fetch

    const map = await resolveLatestSolvapayVersions(SOLVAPAY_RUNTIME_DEPS, { onResolve: () => {} })
    for (const dep of SOLVAPAY_RUNTIME_DEPS) {
      expect(map.get(dep.name)).toBe(dep.fallback)
    }
  })

  it('falls back when the registry returns malformed JSON', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ notVersion: 'oops' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ) as typeof fetch

    const map = await resolveLatestSolvapayVersions(SOLVAPAY_RUNTIME_DEPS, { onResolve: () => {} })
    for (const dep of SOLVAPAY_RUNTIME_DEPS) {
      expect(map.get(dep.name)).toBe(dep.fallback)
    }
  })
})

describe('patchSolvapayVersions', () => {
  let target: string

  beforeEach(async () => {
    target = await makeTempDir()
  })

  afterEach(async () => {
    await rm(target, { recursive: true, force: true })
  })

  it('rewrites @solvapay/* deps to exact pins and preserves other deps', async () => {
    const original = {
      name: 'demo-mcp',
      private: true,
      dependencies: {
        '@modelcontextprotocol/sdk': '^1.29.0',
        '@solvapay/mcp': '^0.2.5',
        '@solvapay/react': '^1.2.0',
        '@solvapay/server': '^1.1.0',
        zod: '^4.3.6',
      },
    }
    await writeFile(path.join(target, 'package.json'), `${JSON.stringify(original, null, 2)}\n`, 'utf8')

    await patchSolvapayVersions(
      target,
      new Map([
        ['@solvapay/mcp', '0.3.7'],
        ['@solvapay/server', '1.2.0'],
        ['@solvapay/react', '1.3.0'],
      ]),
    )

    const patched = JSON.parse(await readFile(path.join(target, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
    }
    expect(patched.dependencies).toEqual({
      '@modelcontextprotocol/sdk': '^1.29.0',
      '@solvapay/mcp': '0.3.7',
      '@solvapay/react': '1.3.0',
      '@solvapay/server': '1.2.0',
      zod: '^4.3.6',
    })
  })

  it('writes pre-1.0 snapshot tags verbatim (no caret)', async () => {
    const original = {
      dependencies: { '@solvapay/mcp': '^0.2.5' },
    }
    await writeFile(path.join(target, 'package.json'), `${JSON.stringify(original, null, 2)}\n`, 'utf8')

    await patchSolvapayVersions(target, new Map([['@solvapay/mcp', '0.0.0-preview-abcdef1']]))

    const patched = JSON.parse(await readFile(path.join(target, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
    }
    expect(patched.dependencies['@solvapay/mcp']).toBe('0.0.0-preview-abcdef1')
  })

  it('skips entries that are not present in the dependencies block', async () => {
    const original = {
      dependencies: { '@solvapay/mcp': '^0.2.5' },
    }
    await writeFile(path.join(target, 'package.json'), `${JSON.stringify(original, null, 2)}\n`, 'utf8')

    await patchSolvapayVersions(
      target,
      new Map([
        ['@solvapay/mcp', '0.3.0'],
        ['@solvapay/server', '1.2.0'],
      ]),
    )

    const patched = JSON.parse(await readFile(path.join(target, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
    }
    expect(patched.dependencies['@solvapay/mcp']).toBe('0.3.0')
    expect(patched.dependencies['@solvapay/server']).toBeUndefined()
  })

  it('end-to-end: scaffold + patch produces the expected dependency snapshot', async () => {
    const substitutions = new Map<string, string>([
      [PLACEHOLDERS.WORKER_NAME, 'snapshot-mcp'],
      [PLACEHOLDERS.RESOURCE_URI_SLUG, 'snapshot-mcp'],
      [PLACEHOLDERS.SERVER_NAME, 'snapshot-mcp'],
      [PLACEHOLDERS.PRODUCT_REF, 'prd_test_456'],
      [PLACEHOLDERS.PUBLIC_BASE_URL, 'http://localhost:8787'],
    ])
    await copyDir(BASE_TEMPLATE_DIR, target, { substitutions })

    await patchSolvapayVersions(
      target,
      new Map([
        ['@solvapay/mcp', '0.3.1'],
        ['@solvapay/react', '1.3.0'],
        ['@solvapay/server', '1.2.0'],
      ]),
    )

    const pkg = JSON.parse(await readFile(path.join(target, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
    }
    expect(pkg.dependencies['@solvapay/mcp']).toBe('0.3.1')
    expect(pkg.dependencies['@solvapay/react']).toBe('1.3.0')
    expect(pkg.dependencies['@solvapay/server']).toBe('1.2.0')
    // Unrelated deps stay on their caret ranges (resolved at npm install time).
    expect(pkg.dependencies['@modelcontextprotocol/sdk']).toMatch(/^\^/)
    expect(pkg.dependencies['zod']).toMatch(/^\^/)
  })
})
