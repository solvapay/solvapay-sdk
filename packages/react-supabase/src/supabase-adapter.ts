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
    /**
     * Supabase's native auth-state subscription. Structurally typed so we
     * don't import `@supabase/supabase-js`. Returns `{ data: { subscription: { unsubscribe } } }`.
     */
    onAuthStateChange: (
      callback: (event: string, session: unknown) => void,
    ) => {
      data: {
        subscription: {
          unsubscribe: () => void
        }
      }
    }
  }
}

/**
 * Configuration for `createSupabaseAuthAdapter`.
 *
 * Pass your app's existing Supabase client so only one `GoTrue` instance is
 * ever in the page. This works with `@supabase/ssr`, custom storage keys,
 * and SSR hydration without the adapter creating a second client.
 */
export type SupabaseAuthAdapterConfig = {
  client: SupabaseClientLike
}

/**
 * Create a Supabase authentication adapter for SolvaPayProvider.
 *
 * @example
 * ```tsx
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
  if (!config || !config.client) {
    throw new Error(
      'createSupabaseAuthAdapter: pass { client } with your existing Supabase client.',
    )
  }

  const client = config.client

  return {
    async getToken(): Promise<string | null> {
      if (typeof window === 'undefined') return null

      try {
        const {
          data: { session },
        } = await client.auth.getSession()
        return session?.access_token || null
      } catch (error) {
        console.warn('[SupabaseAuthAdapter] Failed to get token:', error)
        return null
      }
    },

    async getUserId(): Promise<string | null> {
      if (typeof window === 'undefined') return null

      try {
        const {
          data: { session },
        } = await client.auth.getSession()
        return session?.user?.id || null
      } catch (error) {
        console.warn('[SupabaseAuthAdapter] Failed to get user ID:', error)
        return null
      }
    },

    subscribe(listener: () => void): () => void {
      if (typeof window === 'undefined') {
        return () => undefined
      }

      try {
        const {
          data: { subscription },
        } = client.auth.onAuthStateChange(() => {
          listener()
        })
        return () => {
          try {
            subscription.unsubscribe()
          } catch (error) {
            console.warn('[SupabaseAuthAdapter] Failed to unsubscribe:', error)
          }
        }
      } catch (error) {
        console.warn('[SupabaseAuthAdapter] Failed to subscribe to auth changes:', error)
        return () => undefined
      }
    },
  }
}
