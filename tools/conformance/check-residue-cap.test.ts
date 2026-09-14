import { describe, expect, it } from 'vitest'
import { RESIDUE_KEY_CAP, checkResidueCap, countResidueKeys } from './check-residue-cap.js'

describe('binding-residue cap', () => {
  it('counts top-level keys', () => {
    expect(countResidueKeys('foo:\n  bar: 1\nbaz:\n  quux: 2\n')).toBe(2)
  })

  it('fails when the count grows past the cap', () => {
    const yaml = Array.from({ length: RESIDUE_KEY_CAP + 1 }, (_, i) => `key${i}:\n  x: 1`).join(
      '\n',
    )
    expect(checkResidueCap(yaml)).toMatch(/cap is/)
  })

  it('allows the current cap', () => {
    const yaml = Array.from({ length: RESIDUE_KEY_CAP }, (_, i) => `key${i}:\n  x: 1`).join('\n')
    expect(checkResidueCap(yaml)).toBeUndefined()
  })
})
