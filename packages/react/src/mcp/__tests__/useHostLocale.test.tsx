/**
 * Tests for `useHostLocale` — the Phase 2 hook that mirrors the host's
 * locale from `document.documentElement.lang`.
 *
 * Spec (OpenAI Apps SDK "Build your ChatGPT UI", locale section):
 *   The host writes the active BCP-47 locale into `documentElement.lang`
 *   on every mount and updates it whenever the user switches language
 *   mid-session. Widgets that care about locale read from there.
 *
 * Contract:
 *   - Reads `document.documentElement.lang` on mount.
 *   - Subscribes via `MutationObserver` so mid-session language changes
 *     propagate without a remount.
 *   - Falls back to `navigator.language`, then `'en-US'`.
 */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useHostLocale } from '../useHostLocale'

describe('useHostLocale', () => {
  let originalLang: string

  beforeEach(() => {
    originalLang = document.documentElement.lang
  })

  afterEach(() => {
    document.documentElement.lang = originalLang
  })

  it('returns documentElement.lang when set', () => {
    document.documentElement.lang = 'fr-FR'
    const { result } = renderHook(() => useHostLocale())
    expect(result.current).toBe('fr-FR')
  })

  it('falls back to navigator.language when documentElement.lang is empty', () => {
    document.documentElement.lang = ''
    const { result } = renderHook(() => useHostLocale())
    expect(result.current).toBe(navigator.language || 'en-US')
  })

  it('falls back to "en-US" when both documentElement.lang and navigator.language are empty', () => {
    document.documentElement.lang = ''
    const originalNavLang = navigator.language
    Object.defineProperty(navigator, 'language', {
      configurable: true,
      value: '',
    })
    try {
      const { result } = renderHook(() => useHostLocale())
      expect(result.current).toBe('en-US')
    } finally {
      Object.defineProperty(navigator, 'language', {
        configurable: true,
        value: originalNavLang,
      })
    }
  })

  it('re-renders when documentElement.lang changes mid-session', async () => {
    document.documentElement.lang = 'en-US'
    const { result } = renderHook(() => useHostLocale())
    expect(result.current).toBe('en-US')

    await act(async () => {
      document.documentElement.lang = 'ja-JP'
      // MutationObserver fires asynchronously; give it a microtask.
      await Promise.resolve()
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(result.current).toBe('ja-JP')
  })

  it('disconnects the observer on unmount', () => {
    document.documentElement.lang = 'en-US'
    const { result, unmount } = renderHook(() => useHostLocale())
    expect(result.current).toBe('en-US')
    expect(() => unmount()).not.toThrow()
    // After unmount, mutating `lang` must not throw or leak listeners.
    document.documentElement.lang = 'de-DE'
  })
})
