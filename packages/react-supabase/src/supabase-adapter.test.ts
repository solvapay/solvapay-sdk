import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSupabaseAuthAdapter, type SupabaseClientLike } from './supabase-adapter'

type AuthChangeCallback = (event: string, session: unknown) => void

type TestClient = SupabaseClientLike & {
  _getSessionCalls: number
  _emit: (event: string, session: unknown) => void
  _listenerCount: () => number
}

function makeClient(session: { access_token?: string; user?: { id?: string } } | null): TestClient {
  let calls = 0
  const listeners = new Set<AuthChangeCallback>()
  return {
    auth: {
      getSession: async () => {
        calls++
        return { data: { session } }
      },
      onAuthStateChange: (callback: AuthChangeCallback) => {
        listeners.add(callback)
        return {
          data: {
            subscription: {
              unsubscribe: () => {
                listeners.delete(callback)
              },
            },
          },
        }
      },
    },
    get _getSessionCalls() {
      return calls
    },
    _emit: (event: string, s: unknown) => {
      for (const l of listeners) l(event, s)
    },
    _listenerCount: () => listeners.size,
  } as TestClient
}

describe('createSupabaseAuthAdapter', () => {
  const originalWindow = (globalThis as { window?: unknown }).window

  beforeEach(() => {
    ;(globalThis as { window?: unknown }).window = {}
  })

  afterAll(() => {
    ;(globalThis as { window?: unknown }).window = originalWindow
  })

  it('uses the provided client for getToken and getUserId', async () => {
    const client = makeClient({ access_token: 'tok-123', user: { id: 'user-abc' } })

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

  it('does not warn when constructed with a client', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const client = makeClient({ access_token: 't', user: { id: 'u' } })
      createSupabaseAuthAdapter({ client })
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('throws when client is missing', () => {
    expect(() =>
      // @ts-expect-error - intentionally testing invalid input
      createSupabaseAuthAdapter({}),
    ).toThrow()
  })

  describe('subscribe', () => {
    it('invokes the listener on every auth-state change event', () => {
      const client = makeClient(null)
      const adapter = createSupabaseAuthAdapter({ client })
      const listener = vi.fn()

      const unsubscribe = adapter.subscribe?.(listener)
      expect(typeof unsubscribe).toBe('function')

      client._emit('SIGNED_IN', { user: { id: 'u' } })
      client._emit('TOKEN_REFRESHED', { user: { id: 'u' } })
      client._emit('SIGNED_OUT', null)

      expect(listener).toHaveBeenCalledTimes(3)
    })

    it('unsubscribe stops further listener invocations', () => {
      const client = makeClient(null)
      const adapter = createSupabaseAuthAdapter({ client })
      const listener = vi.fn()

      const unsubscribe = adapter.subscribe?.(listener)
      client._emit('SIGNED_IN', { user: { id: 'u' } })
      expect(listener).toHaveBeenCalledTimes(1)

      unsubscribe?.()
      expect(client._listenerCount()).toBe(0)

      client._emit('SIGNED_OUT', null)
      expect(listener).toHaveBeenCalledTimes(1)
    })
  })
})
