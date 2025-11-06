/**
 * Supabase Auth Adapter for SolvaPay React
 * 
 * Provides Supabase-specific authentication adapter for use with SolvaPayProvider.
 * This adapter integrates with Supabase Auth to get tokens and user IDs.
 */

import type { AuthAdapter } from '@solvapay/react';

export interface SupabaseAuthAdapterConfig {
  /**
   * Supabase project URL
   */
  supabaseUrl: string;
  
  /**
   * Supabase anonymous/public key
   */
  supabaseAnonKey: string;
}

/**
 * Create a Supabase authentication adapter for SolvaPayProvider.
 * 
 * This adapter integrates with Supabase Auth to extract user IDs and tokens
 * from the current Supabase session. It uses Supabase's client-side auth
 * and dynamically imports @supabase/supabase-js to avoid adding it as a
 * dependency if Supabase isn't being used.
 * 
 * The adapter caches the Supabase client instance to avoid recreating it
 * on every call, improving performance.
 * 
 * @param config - Supabase configuration
 * @param config.supabaseUrl - Supabase project URL (required)
 * @param config.supabaseAnonKey - Supabase anonymous/public key (required)
 * @returns AuthAdapter instance compatible with SolvaPayProvider
 * @throws {Error} If supabaseUrl or supabaseAnonKey is missing
 * 
 * @example
 * ```tsx
 * import { createSupabaseAuthAdapter } from '@solvapay/react-supabase';
 * import { SolvaPayProvider } from '@solvapay/react';
 * 
 * function App() {
 *   const adapter = createSupabaseAuthAdapter({
 *     supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
 *     supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
 *   });
 * 
 *   return (
 *     <SolvaPayProvider config={{ auth: { adapter } }}>
 *       <YourApp />
 *     </SolvaPayProvider>
 *   );
 * }
 * ```
 * 
 * @see {@link SolvaPayProvider} for using the adapter
 * @see {@link AuthAdapter} for the adapter interface
 * @since 1.0.0
 */
export function createSupabaseAuthAdapter(
  config: SupabaseAuthAdapterConfig
): AuthAdapter {
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    throw new Error(
      'SupabaseAuthAdapter requires both supabaseUrl and supabaseAnonKey'
    );
  }

  // Cache the Supabase client to avoid recreating it on every call
  let supabaseClient: any = null;
  let clientPromise: Promise<any> | null = null;

  const getSupabaseClient = async () => {
    if (supabaseClient) {
      return supabaseClient;
    }

    if (clientPromise) {
      return clientPromise;
    }

    clientPromise = (async () => {
      try {
        // Dynamic import to avoid requiring @supabase/supabase-js if not installed
        const { createClient } = await import('@supabase/supabase-js');
        supabaseClient = createClient(config.supabaseUrl, config.supabaseAnonKey);
        return supabaseClient;
      } catch (error) {
        // Clear promise on error so we can retry
        clientPromise = null;
        throw new Error(
          'Failed to load @supabase/supabase-js. Make sure it is installed: npm install @supabase/supabase-js'
        );
      }
    })();

    return clientPromise;
  };

  return {
    async getToken(): Promise<string | null> {
      if (typeof window === 'undefined') return null;

      try {
        const supabase = await getSupabaseClient();
        const { data: { session } } = await supabase.auth.getSession();
        return session?.access_token || null;
      } catch (error) {
        // Return null on error - let caller handle unauthenticated state
        console.warn('[SupabaseAuthAdapter] Failed to get token:', error);
        return null;
      }
    },

    async getUserId(): Promise<string | null> {
      if (typeof window === 'undefined') return null;

      try {
        const supabase = await getSupabaseClient();
        const { data: { session } } = await supabase.auth.getSession();
        return session?.user?.id || null;
      } catch (error) {
        // Return null on error - let caller handle unauthenticated state
        console.warn('[SupabaseAuthAdapter] Failed to get user ID:', error);
        return null;
      }
    },
  };
}

