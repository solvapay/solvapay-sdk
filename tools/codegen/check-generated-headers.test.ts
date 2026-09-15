import { describe, expect, it } from 'vitest'
import { generatedEntry } from '../shared/repo-paths.js'
import { hasGeneratedMarker, planClean } from './gen-clean.js'
import {
  checkGeneratedMarkers,
  findUndeclaredMarkerFiles,
  markerTargets,
  runMarkerCheck,
} from './check-generated-headers.js'

describe('generated header gate', () => {
  it('includes tsGenerated which the hardcoded CI list missed', () => {
    const rels = markerTargets(planClean(), '/')
    expect(rels).toContain(generatedEntry('tsGenerated').path)
  })

  it('fails a fixture that omits the marker on generated.ts', () => {
    const rel = generatedEntry('tsGenerated').path
    const issues = checkGeneratedMarkers([rel], '/', file => {
      if (file === rel) {
        return 'export type components = {}\n'
      }
      return '/* @generated */\n'
    })
    expect(issues).toEqual([{ rel, reason: 'unmarked' }])
    expect(hasGeneratedMarker('export type components = {}\n')).toBe(false)
  })
})

describe('findUndeclaredMarkerFiles', () => {
  const reader = (rel: string): string => {
    if (rel === 'a/gen.ts') {
      return '/* @generated */\nexport const x = 1\n'
    }
    return 'export const handwritten = 1\n'
  }

  it('reports a marker file that is not declared', () => {
    const issues = findUndeclaredMarkerFiles(['a/gen.ts'], {
      declared: [],
      exempt: [],
      reader,
    })
    expect(issues).toEqual([{ rel: 'a/gen.ts', reason: 'undeclared' }])
  })

  it('ignores a marker file that is declared', () => {
    const issues = findUndeclaredMarkerFiles(['a/gen.ts'], {
      declared: ['a/gen.ts'],
      exempt: [],
      reader,
    })
    expect(issues).toEqual([])
  })

  it('ignores a marker file that is exempt', () => {
    const issues = findUndeclaredMarkerFiles(['a/gen.ts'], {
      declared: [],
      exempt: [{ pattern: 'a/gen.ts', reason: 'emitter source' }],
      reader,
    })
    expect(issues).toEqual([])
  })

  it('fails a stale exemption that matches no marker-carrying file', () => {
    const issues = findUndeclaredMarkerFiles(['a/gen.ts'], {
      declared: ['a/gen.ts'],
      exempt: [{ pattern: 'gone/old.ts', reason: 'removed' }],
      reader,
    })
    expect(issues).toEqual([{ rel: 'gone/old.ts', reason: 'stale-exemption' }])
  })

  it('does not read binary paths', () => {
    const read: string[] = []
    const issues = findUndeclaredMarkerFiles(['out/core.wasm'], {
      declared: [],
      exempt: [],
      reader: rel => {
        read.push(rel)
        return 'not-a-wasm-string'
      },
    })
    expect(read).toEqual([])
    expect(issues).toEqual([])
  })
})

describe('runMarkerCheck', () => {
  it('accepts the real repo', () => {
    const result = runMarkerCheck()
    expect(result.stderr, result.stderr).toBe('')
    expect(result.exitCode).toBe(0)
  })
})

describe('generated header gate', () => {
  it('includes tsGenerated which the hardcoded CI list missed', () => {
    const rels = markerTargets(planClean(), '/')
    expect(rels).toContain(generatedEntry('tsGenerated').path)
  })

  it('fails a fixture that omits the marker on generated.ts', () => {
    const rel = generatedEntry('tsGenerated').path
    const issues = checkGeneratedMarkers([rel], '/', file => {
      if (file === rel) {
        return 'export type components = {}\n'
      }
      return '/* @generated */\n'
    })
    expect(issues).toEqual([{ rel, reason: 'unmarked' }])
    expect(hasGeneratedMarker('export type components = {}\n')).toBe(false)
  })
})
