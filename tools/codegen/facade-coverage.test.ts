import { describe, expect, it } from 'vitest'
import { FACADES, missingReasons, type FacadeCoverageFile } from './facade-coverage.js'

describe('facade-coverage', () => {
  it('enumerates the 11 sdks/ facades', () => {
    expect(FACADES).toHaveLength(11)
  })

  it('flags gaps that lack a reason', () => {
    const empty = Object.fromEntries(
      FACADES.map(id => [id, { exposed: true as const }]),
    ) as FacadeCoverageFile['ops'][string]
    empty.capi = { exposed: false, reason: '' }
    const coverage: FacadeCoverageFile = {
      _comment: 'test',
      facades: FACADES,
      ops: { createCustomer: empty },
    }
    expect(missingReasons(coverage)).toEqual(['createCustomer.capi'])
  })
})
