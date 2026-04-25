import { describe, it, expect } from 'vitest'
import { interpolate } from './interpolate'

describe('interpolate', () => {
  it('replaces single placeholder', () => {
    expect(interpolate('Hello {name}', { name: 'Alice' })).toBe('Hello Alice')
  })

  it('replaces multiple placeholders', () => {
    expect(
      interpolate('Charge {amount} to {email}', {
        amount: '$5',
        email: 'a@b.com',
      }),
    ).toBe('Charge $5 to a@b.com')
  })

  it('stringifies numbers', () => {
    expect(interpolate('{count} items', { count: 3 })).toBe('3 items')
  })

  it('leaves unknown placeholders intact', () => {
    expect(interpolate('Hello {name}', {})).toBe('Hello {name}')
  })

  it('leaves placeholder intact when value is undefined', () => {
    expect(interpolate('Hello {name}', { name: undefined })).toBe('Hello {name}')
  })

  it('replaces repeated placeholders', () => {
    expect(interpolate('{x} + {x} = {y}', { x: 2, y: 4 })).toBe('2 + 2 = 4')
  })
})
