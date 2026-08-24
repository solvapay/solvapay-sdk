import type { AuthAdapter } from './auth'

const DEFAULT_SENTINEL = 'session-authenticated'

export interface SessionAuthAdapterOptions {
  /** Returns the stable user id (e.g. Auth0 `sub`). */
  getUserId: () => Promise<string | null> | string | null
  /**
   * Optional token for SDK session-alive checks. When omitted, a non-null sentinel
   * is returned whenever `getUserId` resolves to a value.
   */
  getToken?: () => Promise<string | null> | string | null
  sentinelToken?: string
  subscribe?: AuthAdapter['subscribe']
}

async function resolveValue<T>(value: Promise<T> | T): Promise<T> {
  return value
}

/**
 * Client adapter for httpOnly-cookie session auth where the browser cannot read
 * the real credential. Reports authenticated state via a sentinel token.
 */
export function createSessionAuthAdapter(options: SessionAuthAdapterOptions): AuthAdapter {
  const sentinel = options.sentinelToken ?? DEFAULT_SENTINEL

  return {
    async getToken() {
      if (options.getToken) {
        return resolveValue(options.getToken())
      }

      const userId = await resolveValue(options.getUserId())
      return userId ? sentinel : null
    },

    async getUserId() {
      return resolveValue(options.getUserId())
    },

    subscribe: options.subscribe,
  }
}
