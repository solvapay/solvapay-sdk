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
  it('marks Python path sources editable so they match solvapay-mcp', () => {
    const raw = `[project]\ndependencies = ["solvapay==0.1.0", "solvapay-mcp==0.1.0"]\n`
    const out = applyDevPathDeps('python', raw, {
      solvapay: '/repo/sdks/python',
      'solvapay-mcp': '/repo/sdks/python-mcp',
    })
    expect(out).toContain('[tool.uv.sources]')
    expect(out).toContain('solvapay = { path = "/repo/sdks/python", editable = true }')
    expect(out).toContain('solvapay-mcp = { path = "/repo/sdks/python-mcp", editable = true }')
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
