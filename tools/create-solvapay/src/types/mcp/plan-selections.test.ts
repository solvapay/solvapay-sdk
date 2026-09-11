import { describe, expect, it } from 'vitest'
import {
  collectPlanSelectionReminders,
  isPlanEligibleForDefault,
  validatePlanSelections,
} from '../../../scripts/mcp/lib/plan-selections.mjs'

describe('plan-selections', () => {
  it('accepts a free recurring default with freeUnits', () => {
    expect(() =>
      validatePlanSelections([
        {
          name: 'Free',
          type: 'recurring',
          price: 0,
          freeUnits: 50,
          default: true,
        },
      ]),
    ).not.toThrow()
  })

  it('accepts a free usage-based default', () => {
    expect(isPlanEligibleForDefault({ type: 'usage-based', creditsPerUnit: 0 })).toBe(true)
    expect(() =>
      validatePlanSelections([{ type: 'usage-based', creditsPerUnit: 0, default: true }]),
    ).not.toThrow()
  })

  it('rejects a paid usage-based default', () => {
    expect(isPlanEligibleForDefault({ type: 'usage-based', creditsPerUnit: 100 })).toBe(false)
    expect(() =>
      validatePlanSelections([{ type: 'usage-based', creditsPerUnit: 100, default: true }]),
    ).toThrow(/cannot be the default plan/)
  })

  it('rejects paid recurring defaults', () => {
    expect(() =>
      validatePlanSelections([{ name: 'Pro', type: 'recurring', price: 2000, default: true }]),
    ).toThrow(/cannot be the default plan/)
  })

  it('rejects one-time and hybrid defaults', () => {
    expect(() => validatePlanSelections([{ type: 'one-time', price: 0, default: true }])).toThrow(
      /cannot be the default plan/,
    )
    expect(() => validatePlanSelections([{ type: 'hybrid', price: 0, default: true }])).toThrow(
      /cannot be the default plan/,
    )
  })

  it('rejects multiple default flags', () => {
    expect(() =>
      validatePlanSelections([
        { type: 'recurring', price: 0, default: true },
        { type: 'recurring', price: 0, default: true },
      ]),
    ).toThrow(/at most one plan/)
  })

  it('reminds when a free recurring default has no freeUnits', () => {
    const reminders = collectPlanSelectionReminders([
      { type: 'recurring', price: 0, default: true },
    ])
    expect(reminders).toHaveLength(1)
    expect(reminders[0]).toContain('freeUnits')
  })
})
