import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SURFACES, nativeSurfaces, coreSurfaces, nativePrepareTasks } from './surfaces.js'

describe('surfaces registry', () => {
  it('should keep core and native partitions disjoint and non-empty', () => {
    const core = coreSurfaces()
    const native = nativeSurfaces()
    expect(core.length).toBeGreaterThan(0)
    expect(native.length).toBeGreaterThan(0)
    const overlap = core.filter(surface => native.some(other => other.id === surface.id))
    expect(overlap).toEqual([])
  })

  it('should resolve every surface cwd on disk', () => {
    for (const surface of SURFACES) {
      expect(existsSync(surface.cwd), surface.id).toBe(true)
    }
  })

  it('should declare a requires entry on every native surface', () => {
    for (const surface of nativeSurfaces()) {
      expect((surface.requires ?? []).length, surface.id).toBeGreaterThan(0)
    }
  })

  it('should list a prepare task on every testsRequireBuild surface', () => {
    for (const surface of SURFACES) {
      if (surface.testsRequireBuild === true) {
        expect((surface.prepare ?? []).length, surface.id).toBeGreaterThan(0)
      }
    }
  })

  it('should prefer prepare over build so Python is importable in place', () => {
    const python = nativePrepareTasks().find(task => task.id.startsWith('python.'))
    expect(python?.id).toBe('python.prepare')
    expect(python?.args).toEqual(['develop', '--release'])
  })

  it('should fall back to build when a native surface has no prepare', () => {
    const ids = nativePrepareTasks().map(task => task.id)
    expect(ids).toContain('go-guest.build')
    expect(ids.some(id => id.startsWith('rust.'))).toBe(false)
  })
})
