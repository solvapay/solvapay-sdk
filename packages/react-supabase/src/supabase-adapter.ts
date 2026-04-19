/**
 * Supabase Auth Adapter for SolvaPay React
 *
 * Provides Supabase-specific authentication adapter for use with SolvaPayProvider.
 * This adapter integrates with Supabase Auth to get tokens and user IDs.
 */

import type { AuthAdapter } from '@solvapay/react'

/**
 * Structural shape of a Supabase client as used by the adapter.
 *
 * Matches `SupabaseClient` from `@supabase/supabase-js` without importing
 * the type, so consumers pass the real client without a cast and this
 * package stays dependency-light.
 */
export type SupabaseClientLike = {
  auth: {
    getSession: () => Promise<{
      data: {
        session: { access_token?: string; user?: { id?: string } } | null
      }
    }>
  }
}

/**
 * Configuration for `createSupabaseAuthAdapter`.
 *
 * Prefer the `{ client }` form: pass your app's existing Supabase client so
 * only one `GoTrue` instance is ever in the page. The URL/key form is kept
 * for backwards compatibility but creates a second client that can miss
 * sessions when the host app uses custom storage keys, `@supabase/ssr`, or
 * iframe-isolated storage.
 */
export type SupabaseAuthAdapterConfig =
  | {
      /** The host app's existing Supabase client. Recommended. */
      client: SupabaseClientLike
    }
  | {
      /** @deprecated Prefer `{ client }` — pass your existing Supabase client instead. */
      supabaseUrl: string
      /** @deprecated Prefer `{ client }` — pass your existing Supabase client instead. */
      supabaseAnonKey: string
    }

let urlKeyDeprecationWarned = false

function isClientConfig(
  config: SupabaseAuthAdapterConfig,
): config is { client: SupabaseClientLike } {
  return 'client' in config && config.client !== undefined && config.client !== null
}

/**
 * Create a Supabase authentication adapter for SolvaPayProvider.
 *
 * Two configuration forms are supported:
 *
 * 1. **`{ client }` (recommended)** — reuse the host app's existing Supabase
 *    client. No dynamic import, no second `GoTrue` instance, works with
 *    `@supabase/ssr` and custom storage configurations.
 * 2. **`{ supabaseUrl, supabaseAnonKey }` (deprecated)** — the adapter
 *    dynamically imports `@supabase/supabase-js` and creates its own client.
 *    Emits a one-time `console.warn` recommending migration to `{ client }`.
 *
 * @example
 * ```tsx
 * // Recommended: reuse the host app's client
 * import { createClient } from '@supabase/supabase-js'
 * import { createSupabaseAuthAdapter } from '@solvapay/react-supabase'
 * import { SolvaPayProvider } from '@solvapay/react'
 *
 * const supabase = createClient(url, anonKey)
 * const adapter = createSupabaseAuthAdapter({ client: supabase })
 *
 * export function App() {
 *   return (
 *     <SolvaPayProvider config={{ auth: { adapter } }}>
 *       <YourApp />
 *     </SolvaPayProvider>
 *   )
 * }
 * ```
 *
 * @see SolvaPayProvider (from `@solvapay/react`) for using the adapter
 * @see {@link AuthAdapter} for the adapter interface
 * @since 1.0.0
 */
export function createSupabaseAuthAdapter(config: SupabaseAuthAdapterConfig): AuthAdapter {
  if (isClientConfig(config)) {
    return adapterFromClient(() => Promise.resolve(config.client))
  }

  const { supabaseUrl, supabaseAnonKey } = config
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'createSupabaseAuthAdapter: pass { client } with your existing Supabase client, or { supabaseUrl, supabaseAnonKey } to have the adapter create one.',
    )
  }

  if (!urlKeyDeprecationWarned) {
    urlKeyDeprecationWarned = true
    console.warn(
      '[SupabaseAuthAdapter] The { supabaseUrl, supabaseAnonKey } form is deprecated and creates a second GoTrueClient that can miss sessions with @supabase/ssr or custom auth.storageKey. Pass { client: yourExistingSupabaseClient } instead.',
    )
  }

  let supabaseClient: SupabaseClientLike | null = null
  let clientPromise: Promise<SupabaseClientLike> | null = null

  const getClient = (): Promise<SupabaseClientLike> => {
    if (supabaseClient) return Promise.resolve(supabaseClient)
    if (clientPromise) return clientPromise

    clientPromise = (async () => {
      try {
        const { createClient } = await import('@supabase/supabase-js')
        const client = createClient(supabaseUrl, supabaseAnonKey) as unknown as SupabaseClientLike
        supabaseClient = client
        return client
      } catch {
        clientPromise = null
        throw new Error(
          'Failed to load @supabase/supabase-js. Make sure it is installed: npm install @supabase/supabase-js',
        )
      }
    })()

    return clientPromise
  }

  return adapterFromClient(getClient)
}

function adapterFromClient(getClient: () => Promise<SupabaseClientLike>): AuthAdapter {
  return {
    async getToken(): Promise<string | null> {
      if (typeof window === 'undefined') return null

      try {
        const supabase = await getClient()
        const {
          data: { session },
        } = await supabase.auth.getSession()
        return session?.access_token || null
      } catch (error) {
        console.warn('[SupabaseAuthAdapter] Failed to get token:', error)
        return null
      }
    },

    async getUserId(): Promise<string | null> {
      if (typeof window === 'undefined') return null

      try {
        const supabase = await getClient()
        const {
          data: { session },
        } = await supabase.auth.getSession()
        return session?.user?.id || null
      } catch (error) {
        console.warn('[SupabaseAuthAdapter] Failed to get user ID:', error)
        return null
      }
    },
  }
}

/**
 * Test-only: reset the one-time deprecation warning flag so tests can
 * assert the warning fires exactly once per process in realistic usage.
 *
 * @internal
 */
export function __resetUrlKeyDeprecationWarned(): void {
  urlKeyDeprecationWarned = false
}
