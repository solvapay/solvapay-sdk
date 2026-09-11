import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  createAnonymousAuthAdapter,
  getOrCreateAnonymousCustomerRef,
  resetAnonymousCustomerRef,
} from './auth'

describe('anonymous auth adapter', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('getOrCreateAnonymousCustomerRef', () => {
    it('mints a new anon_<uuid> ref on first call and persists it', () => {
      const ref = getOrCreateAnonymousCustomerRef()
      expect(ref).toMatch(/^anon_/)
      expect(window.localStorage.getItem('solvapay:anonymousCustomerRef')).toBe(ref)
    })

    it('returns the same ref across calls (round-trips localStorage)', () => {
      const a = getOrCreateAnonymousCustomerRef()
      const b = getOrCreateAnonymousCustomerRef()
      expect(a).toBe(b)
    })

    it('honours an explicit storage key override', () => {
      const ref = getOrCreateAnonymousCustomerRef('myapp:anon')
      expect(window.localStorage.getItem('myapp:anon')).toBe(ref)
      expect(window.localStorage.getItem('solvapay:anonymousCustomerRef')).toBeNull()
    })

    it('returns the SSR placeholder when window is undefined', () => {
      const original = globalThis.window
      // @ts-expect-error - testing SSR path
      delete globalThis.window
      try {
        expect(getOrCreateAnonymousCustomerRef()).toBe('anon_ssr')
      } finally {
        globalThis.window = original
      }
    })
  })

  describe('resetAnonymousCustomerRef', () => {
    it('clears the persisted ref so the next call mints a fresh one', () => {
      const first = getOrCreateAnonymousCustomerRef()
      resetAnonymousCustomerRef()
      const second = getOrCreateAnonymousCustomerRef()
      expect(second).not.toBe(first)
    })

    it('is safe to call when no ref is persisted', () => {
      expect(() => resetAnonymousCustomerRef()).not.toThrow()
    })
  })

  describe('createAnonymousAuthAdapter', () => {
    it('returns an AuthAdapter where getToken/getUserId both yield the customer ref', async () => {
      const adapter = createAnonymousAuthAdapter('anon_abc')
      await expect(adapter.getToken()).resolves.toBe('anon_abc')
      await expect(adapter.getUserId()).resolves.toBe('anon_abc')
    })

    it('binds the ref at adapter-creation time (closure, not lookup)', async () => {
      const adapter = createAnonymousAuthAdapter('anon_first')
      // localStorage churn after creation should not affect the adapter.
      window.localStorage.setItem('solvapay:anonymousCustomerRef', 'anon_other')
      await expect(adapter.getToken()).resolves.toBe('anon_first')
    })
  })
})
