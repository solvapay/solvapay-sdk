import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyDevPathDeps, patchManifest, rewriteManifest } from './patch-manifest'

describe('rewriteManifest', () => {
  it('pins solvapay in Cargo.toml', () => {
    const raw = `[dependencies]\nsolvapay = "0.0.0"\nsolvapay-mcp = { version = "0.0.0" }\naxum = "0.8"\n`
    const out = rewriteManifest(
      'rust',
      raw,
      new Map([
        ['solvapay', '0.1.0'],
        ['solvapay-mcp', '0.1.0'],
      ]),
    )
    expect(out).toContain('solvapay = "0.1.0"')
    expect(out).toContain('solvapay-mcp = { version = "0.1.0" }')
    expect(out).toContain('axum = "0.8"')
  })

  it('pins solvapay in pyproject.toml', () => {
    const raw = `dependencies = [\n  "solvapay==0.0.0",\n  "httpx>=0.27",\n]\n`
    const out = rewriteManifest('python', raw, new Map([['solvapay', '0.1.0']]))
    expect(out).toContain('"solvapay==0.1.0"')
    expect(out).toContain('"httpx>=0.27"')
  })

  it('pins gems in a Gemfile', () => {
    const raw = `source "https://rubygems.org"\ngem "solvapay"\ngem "puma"\n`
    const out = rewriteManifest('ruby', raw, new Map([['solvapay', '0.1.0']]))
    expect(out).toContain('gem "solvapay", "0.1.0"')
    expect(out).toContain('gem "puma"')
  })

  it('pins go.mod module versions', () => {
    const raw = `module example.com/demo\n\nrequire github.com/solvapay/solvapay-sdk/sdks/go v0.0.0\n`
    const out = rewriteManifest(
      'go',
      raw,
      new Map([['github.com/solvapay/solvapay-sdk/sdks/go', 'v0.2.0']]),
    )
    expect(out).toContain('github.com/solvapay/solvapay-sdk/sdks/go v0.2.0')
  })
})

describe('applyDevPathDeps', () => {
  it('rewrites TS @solvapay deps to link: by default, preserving other deps', () => {
    const raw = `${JSON.stringify(
      {
        name: 'my-mcp',
        dependencies: {
          '@solvapay/mcp': '^1.0.0',
          '@solvapay/core': '^2.0.0',
          '@solvapay/server-wasm': '^0.2.0',
          zod: '^4.3.6',
        },
      },
      null,
      2,
    )}\n`
    const out = applyDevPathDeps('ts', raw, {
      '@solvapay/mcp': '/repo/sdks/typescript/mcp',
      '@solvapay/core': '/repo/sdks/typescript/core',
      '@solvapay/server-wasm': '/repo/sdks/wasm',
    })
    const pkg = JSON.parse(out) as { dependencies: Record<string, string> }
    expect(pkg.dependencies['@solvapay/mcp']).toBe('link:/repo/sdks/typescript/mcp')
    expect(pkg.dependencies['@solvapay/core']).toBe('link:/repo/sdks/typescript/core')
    expect(pkg.dependencies['@solvapay/server-wasm']).toBe('link:/repo/sdks/wasm')
    // Third-party deps are untouched, and the trailing newline is preserved.
    expect(pkg.dependencies.zod).toBe('^4.3.6')
    expect(out.endsWith('\n')).toBe(true)
  })

  it('uses file: protocol for npm (no link: support)', () => {
    const raw = `${JSON.stringify({ dependencies: { '@solvapay/core': '^2.0.0' } }, null, 2)}\n`
    const out = applyDevPathDeps(
      'ts',
      raw,
      { '@solvapay/core': '/repo/sdks/typescript/core' },
      'file',
    )
    const pkg = JSON.parse(out) as { dependencies: Record<string, string> }
    expect(pkg.dependencies['@solvapay/core']).toBe('file:/repo/sdks/typescript/core')
  })

  it('writes Python path sources as non-editable (scaffold lane default)', () => {
    const raw = `[project]\ndependencies = ["solvapay==0.1.0", "solvapay-mcp==0.1.0"]\n`
    const out = applyDevPathDeps('python', raw, {
      solvapay: '/repo/sdks/python',
      'solvapay-mcp': '/repo/sdks/python-mcp',
    })
    expect(out).toContain('[tool.uv.sources]')
    expect(out).toContain('solvapay = { path = "/repo/sdks/python" }')
    expect(out).toContain('solvapay-mcp = { path = "/repo/sdks/python-mcp" }')
    expect(out).not.toContain('editable')
  })

  it('keeps Python path sources editable when opted in', () => {
    const raw = `[project]\ndependencies = ["solvapay==0.1.0"]\n`
    const out = applyDevPathDeps('python', raw, { solvapay: '/repo/sdks/python' }, 'link', {
      pythonEditable: true,
    })
    expect(out).toContain('solvapay = { path = "/repo/sdks/python", editable = true }')
  })

  it('rewrites Ruby gems to path:', () => {
    const raw = `gem "solvapay", "0.1.0"\ngem "solvapay-mcp", "0.1.0"\n`
    const out = applyDevPathDeps('ruby', raw, {
      solvapay: '/repo/sdks/ruby',
      'solvapay-mcp': '/repo/sdks/ruby-mcp',
    })
    expect(out).toContain('gem "solvapay", path: "/repo/sdks/ruby"')
    expect(out).toContain('gem "solvapay-mcp", path: "/repo/sdks/ruby-mcp"')
  })
})

describe('patchManifest', () => {
  let target: string

  beforeEach(async () => {
    target = await mkdtemp(path.join(os.tmpdir(), 'create-solvapay-manifest-'))
  })

  afterEach(async () => {
    await rm(target, { recursive: true, force: true })
  })

  it('rewrites Cargo.toml on disk', async () => {
    await writeFile(path.join(target, 'Cargo.toml'), '[dependencies]\nsolvapay = "0.0.0"\n', 'utf8')
    await patchManifest('rust', target, new Map([['solvapay', '0.1.0']]))
    const raw = await readFile(path.join(target, 'Cargo.toml'), 'utf8')
    expect(raw).toContain('solvapay = "0.1.0"')
  })
})
