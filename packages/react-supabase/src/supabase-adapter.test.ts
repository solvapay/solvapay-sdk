import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetUrlKeyDeprecationWarned,
  createSupabaseAuthAdapter,
  type SupabaseClientLike,
} from './supabase-adapter'

function makeClient(
  session: { access_token?: string; user?: { id?: string } } | null,
): SupabaseClientLike & { _getSessionCalls: number } {
  let calls = 0
  return {
    auth: {
      getSession: async () => {
        calls++
        return { data: { session } }
      },
    },
    get _getSessionCalls() {
      return calls
    },
  } as SupabaseClientLike & { _getSessionCalls: number }
}

describe('createSupabaseAuthAdapter', () => {
  const originalWindow = (globalThis as { window?: unknown }).window

  beforeEach(() => {
    __resetUrlKeyDeprecationWarned()
    // Simulate a browser environment (adapter short-circuits to null server-side).
    ;(globalThis as { window?: unknown }).window = {}
  })

  afterAll(() => {
    ;(globalThis as { window?: unknown }).window = originalWindow
  })

  describe('{ client } form', () => {
    it('uses the provided client without dynamic import', async () => {
      const client = makeClient({
        access_token: 'tok-123',
        user: { id: 'user-abc' },
      })

      const adapter = createSupabaseAuthAdapter({ client })

      expect(await adapter.getToken()).toBe('tok-123')
      expect(await adapter.getUserId()).toBe('user-abc')
    })

    it('returns null when there is no active session', async () => {
      const client = makeClient(null)
      const adapter = createSupabaseAuthAdapter({ client })

      expect(await adapter.getToken()).toBeNull()
      expect(await adapter.getUserId()).toBeNull()
    })

    it('does not emit the URL/key deprecation warning', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      try {
        const client = makeClient({ access_token: 't', user: { id: 'u' } })
        createSupabaseAuthAdapter({ client })
        expect(warnSpy).not.toHaveBeenCalled()
      } finally {
        warnSpy.mockRestore()
      }
    })
  })

  describe('URL/key form (back-compat)', () => {
    it('emits the deprecation warning exactly once across multiple calls', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      try {
        createSupabaseAuthAdapter({
          supabaseUrl: 'https://a.supabase.co',
          supabaseAnonKey: 'anon-a',
        })
        createSupabaseAuthAdapter({
          supabaseUrl: 'https://b.supabase.co',
          supabaseAnonKey: 'anon-b',
        })
        createSupabaseAuthAdapter({
          supabaseUrl: 'https://c.supabase.co',
          supabaseAnonKey: 'anon-c',
        })

        const deprecationWarnings = warnSpy.mock.calls.filter(args =>
          typeof args[0] === 'string' && args[0].includes('deprecated'),
        )
        expect(deprecationWarnings).toHaveLength(1)
      } finally {
        warnSpy.mockRestore()
      }
    })

    it('throws when url or key is missing', () => {
      expect(() =>
        createSupabaseAuthAdapter({ supabaseUrl: '', supabaseAnonKey: 'anon' }),
      ).toThrow()
      expect(() =>
        createSupabaseAuthAdapter({ supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: '' }),
      ).toThrow()
    })
  })
})
