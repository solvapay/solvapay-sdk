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
 * Create a Supabase auth adapter for SolvaPayProvider
 * 
 * This adapter uses Supabase's client-side auth to get tokens and user IDs.
 * It dynamically imports @supabase/supabase-js to avoid adding it as a dependency
 * if Supabase isn't being used.
 * 
 * @param config - Supabase configuration
 * @returns AuthAdapter instance
 * 
 * @example
 * ```tsx
 * import { createSupabaseAuthAdapter } from '@solvapay/react-supabase';
 * import { SolvaPayProvider } from '@solvapay/react';
 * 
 * const adapter = createSupabaseAuthAdapter({
 *   supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
 *   supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
 * });
 * 
 * <SolvaPayProvider config={{ auth: { adapter } }}>
 *   {children}
 * </SolvaPayProvider>
 * ```
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

