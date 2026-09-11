import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from './paths.js'
import { loadRepoPathsManifest } from './repo-paths.js'

const EXPECTED_IDS = [
  'nodeNativeNapi',
  'wasmPkg',
  'goCoreWasm',
  'capiHeader',
  'capiFixtureHostHeader',
  'mcpAppWidget',
] as const

describe('externalGenerated manifest section', () => {
  it('is defined and has at least six entries', () => {
    const manifest = loadRepoPathsManifest()
    expect(manifest.externalGenerated).toBeDefined()
    expect(manifest.externalGenerated.length).toBeGreaterThanOrEqual(6)
    const ids = manifest.externalGenerated.map(entry => entry.id)
    for (const id of EXPECTED_IDS) {
      expect(ids).toContain(id)
    }
  })

  it('every declared path exists on disk', () => {
    const manifest = loadRepoPathsManifest()
    for (const entry of manifest.externalGenerated) {
      for (const rel of entry.paths) {
        expect(existsSync(path.join(REPO_ROOT, rel)), rel).toBe(true)
      }
    }
  })

  it('ids are unique and disjoint from generated ids', () => {
    const manifest = loadRepoPathsManifest()
    const generatedIds = new Set(manifest.generated.map(entry => entry.id))
    const seen = new Set<string>()
    for (const entry of manifest.externalGenerated) {
      expect(seen.has(entry.id), `duplicate externalGenerated id: ${entry.id}`).toBe(false)
      expect(
        generatedIds.has(entry.id),
        `externalGenerated id collides with generated: ${entry.id}`,
      ).toBe(false)
      seen.add(entry.id)
    }
  })

  it('every entry declares a non-empty generator', () => {
    const manifest = loadRepoPathsManifest()
    for (const entry of manifest.externalGenerated) {
      expect(entry.generator.length, entry.id).toBeGreaterThan(0)
    }
  })

  it('binary: true implies marker: null', () => {
    const manifest = loadRepoPathsManifest()
    for (const entry of manifest.externalGenerated) {
      if (entry.binary) {
        expect(entry.marker, entry.id).toBeNull()
      }
    }
  })
})
