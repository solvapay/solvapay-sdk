import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectReferencedPaths, isUnderLegacyDir } from './lib/referenced-paths.js'
import { joinRoot, REPO_ROOT } from '../shared/paths.js'
import { loadRepoPathsManifest } from '../shared/repo-paths.js'

describe('referenced tool paths', () => {
  const referenced = collectReferencedPaths()

  it('every referenced path resolves on disk', { timeout: 30_000 }, () => {
    const missing = referenced
      .filter(ref => !existsSync(ref.resolved))
      .map(ref => `${ref.source}: ${ref.raw} -> ${ref.resolved}`)
    expect(missing).toEqual([])
  })

  it('no reference resolves into a dissolved top-level directory', { timeout: 30_000 }, () => {
    const intoLegacy = referenced
      .filter(ref => isUnderLegacyDir(ref.resolved))
      .map(ref => `${ref.source}: ${ref.raw} -> ${path.relative(REPO_ROOT, ref.resolved)}`)
    expect(intoLegacy).toEqual([])
  })

  it('collects a ci.yml working-directory pointing at the python SDK', () => {
    const pythonRel = loadRepoPathsManifest().sdks.python
    const pythonAbs = joinRoot(pythonRel)
    const hits = referenced.filter(
      ref =>
        ref.source.includes('.github/workflows/ci.yml') &&
        (ref.resolved === pythonAbs ||
          path.relative(REPO_ROOT, ref.resolved).split(path.sep).join('/') === pythonRel),
    )
    expect(hits.length).toBeGreaterThan(0)
  })

  it('collects paths from .husky/pre-commit', () => {
    const hits = referenced.filter(ref => ref.source.includes('.husky/pre-commit'))
    expect(hits.length).toBeGreaterThan(0)
  })

  it('collects the pnpm-workspace.yaml package glob', () => {
    const hits = referenced.filter(ref => ref.source.includes('pnpm-workspace.yaml'))
    expect(hits.length).toBeGreaterThan(0)
  })

  it('collects Cargo.toml members and path deps', () => {
    const hits = referenced.filter(ref => ref.source.endsWith('Cargo.toml'))
    expect(hits.length).toBeGreaterThan(0)
  })

  it('collects at least 80 references from ci.yml', { timeout: 30_000 }, () => {
    const fromCi = referenced.filter(ref =>
      ref.source.includes('.github/workflows/ci.yml'),
    )
    expect(fromCi.length).toBeGreaterThanOrEqual(80)
  })
})
