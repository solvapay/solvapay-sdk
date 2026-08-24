import { describe, expect, it } from 'vitest'
import { generatedEntry } from '../shared/repo-paths.js'
import { hasGeneratedMarker, planClean } from './gen-clean.js'
import { checkGeneratedMarkers, markerTargets } from './check-generated-headers.js'

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
