import { describe, expect, it } from 'vitest'
import { buildTestPlanOptions } from './integration-setup'

describe('buildTestPlanOptions', () => {
  it('auto-assigns a free metered fixture', () => {
    const options = buildTestPlanOptions({ freeUnits: 10 })
    expect(options).toContainEqual({ kind: 'autoAssigned' })
    expect(options).toContainEqual(
      expect.objectContaining({ kind: 'charge', per: 'unit', amountMinor: 0 }),
    )
  })

  it('omits autoAssigned on a paid usage plan when isDefault is omitted', () => {
    const options = buildTestPlanOptions({
      type: 'usage-based',
      creditsPerUnit: 100,
      freeUnits: 0,
    })
    expect(options.some(o => o.kind === 'autoAssigned')).toBe(false)
    expect(options).toContainEqual(
      expect.objectContaining({ kind: 'charge', per: 'unit', amountMinor: 100 }),
    )
  })

  it('omits autoAssigned when isDefault is false', () => {
    const options = buildTestPlanOptions({
      type: 'usage-based',
      creditsPerUnit: 100,
      freeUnits: 0,
      isDefault: false,
    })
    expect(options.some(o => o.kind === 'autoAssigned')).toBe(false)
  })

  it('throws when a paid plan is explicitly marked default', () => {
    expect(() =>
      buildTestPlanOptions({
        type: 'usage-based',
        creditsPerUnit: 100,
        freeUnits: 0,
        isDefault: true,
      }),
    ).toThrow(/Only free plans can be auto-assigned/)
  })
})
