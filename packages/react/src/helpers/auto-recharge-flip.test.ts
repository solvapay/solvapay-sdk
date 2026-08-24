import { describe, it, expect } from 'vitest'
import {
  flipUnitValue,
  type AmountInputUnit,
  type AmountInputAnchor,
} from './auto-recharge-form'

const CPM = 100
const SEK_RATE = 9.46

function flip(
  anchor: AmountInputAnchor,
  currentUnit: AmountInputUnit,
  currency = 'SEK',
): { value: string; unit: AmountInputUnit } {
  const targetUnit: AmountInputUnit = currentUnit === 'currency' ? 'credits' : 'currency'
  return flipUnitValue(anchor, targetUnit, currency, CPM, SEK_RATE)
}

describe('flipUnitValue (DEV-591: snap-back to user-entered base)', () => {
  it('restores credits anchor exactly after currency→credits round-trip', () => {
    const anchor: AmountInputAnchor = { value: '105700', unit: 'credits' }
    const toCurrency = flip(anchor, 'credits')
    expect(toCurrency.unit).toBe('currency')
    const backToCredits = flip(anchor, toCurrency.unit)
    expect(backToCredits.unit).toBe('credits')
    expect(backToCredits.value).toBe('105700')
  })

  it('restores currency anchor exactly after credits→currency round-trip', () => {
    const anchor: AmountInputAnchor = { value: '100', unit: 'currency' }
    const toCredits = flip(anchor, 'currency')
    expect(toCredits.unit).toBe('credits')
    const backToCurrency = flip(anchor, toCredits.unit)
    expect(backToCurrency.unit).toBe('currency')
    expect(backToCurrency.value).toBe('100')
  })

  it('does not drift after repeated flips from a currency anchor', () => {
    const anchor: AmountInputAnchor = { value: '100', unit: 'currency' }
    let currentUnit: AmountInputUnit = 'currency'
    let currentValue = anchor.value

    for (let i = 0; i < 10; i += 1) {
      const next = flipUnitValue(
        anchor,
        currentUnit === 'currency' ? 'credits' : 'currency',
        'SEK',
        CPM,
        SEK_RATE,
      )
      currentUnit = next.unit
      currentValue = next.value
    }

    expect(currentUnit).toBe('currency')
    expect(currentValue).toBe('100')
  })

  it('derives from updated anchor after user edits in credits', () => {
    const anchor: AmountInputAnchor = { value: '200000', unit: 'credits' }
    const toCurrency = flipUnitValue(anchor, 'currency', 'SEK', CPM, SEK_RATE)
    expect(toCurrency.unit).toBe('currency')
    const backToCredits = flipUnitValue(anchor, 'credits', 'SEK', CPM, SEK_RATE)
    expect(backToCredits.value).toBe('200000')
  })

  it('returns value unchanged for invalid or non-positive input', () => {
    expect(
      flipUnitValue({ value: '', unit: 'currency' }, 'credits', 'USD', CPM, 1),
    ).toEqual({ value: '', unit: 'credits' })
    expect(
      flipUnitValue({ value: 'abc', unit: 'currency' }, 'credits', 'USD', CPM, 1),
    ).toEqual({ value: 'abc', unit: 'credits' })
    expect(
      flipUnitValue({ value: '0', unit: 'currency' }, 'credits', 'USD', CPM, 1),
    ).toEqual({ value: '0', unit: 'credits' })
  })

  it('preserves JPY whole-yen anchor on round-trip', () => {
    const anchor: AmountInputAnchor = { value: '500', unit: 'currency' }
    const JPY_RATE = 150
    const toCredits = flipUnitValue(anchor, 'credits', 'JPY', CPM, JPY_RATE)
    const back = flipUnitValue(anchor, 'currency', 'JPY', CPM, JPY_RATE)
    expect(back.value).toBe('500')
    expect(Number.isInteger(Number(toCredits.value))).toBe(true)
  })
})
