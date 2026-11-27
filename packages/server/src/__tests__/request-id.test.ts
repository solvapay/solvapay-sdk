import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateRequestId } from '../request-id'

const SHAPE = /^solvapay_\d+_[a-z0-9]{9}$/

describe('generateRequestId', () => {
  afterEach(() => vi.restoreAllMocks())

  it('is solvapay_<ms>_ followed by nine characters from a-z0-9', () => {
    expect(generateRequestId(1794484800000)).toMatch(/^solvapay_1794484800000_[a-z0-9]{9}$/)
    for (let i = 0; i < 10_000; i++) expect(generateRequestId()).toMatch(SHAPE)
  })

  it('keeps nine characters when Math.random would have given a short string', () => {
    // (0.5).toString(36) is "0.i": the old generator returned one character.
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    expect(generateRequestId()).toMatch(SHAPE)
  })

  it('skips bytes that would favour some characters, and draws again', () => {
    let call = 0
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(array => {
      const bytes = array as Uint8Array
      // First draw: only bytes from 252 up, all skipped. Second: 0, 1, 2, …
      bytes.forEach((_, i) => (bytes[i] = call === 0 ? 252 + (i % 4) : i))
      call++
      return array
    })
    expect(generateRequestId(1)).toBe('solvapay_1_abcdefghi')
    expect(call).toBe(2)
  })
})
