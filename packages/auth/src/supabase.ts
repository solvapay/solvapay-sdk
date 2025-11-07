/**
 * Supabase Auth Adapter
 * 
 * Extracts user ID from Supabase JWT tokens using HS256 verification.
 * Works in both Node.js and Edge runtimes (uses dynamic import for jose).
 */

import type { AuthAdapter, RequestLike } from './adapter';

export interface SupabaseAuthAdapterConfig {
  /**
   * Supabase JWT secret (from Supabase dashboard: Settings → API → JWT Secret)
   */
  jwtSecret: string;
}

/**
 * Supabase authentication adapter
 * 
 * Verifies Supabase JWT tokens and extracts the user ID from the `sub` claim.
 * Uses dynamic import for jose to keep the package lean and Edge-compatible.
 * 
 * @example
 * ```ts
 * import { SupabaseAuthAdapter } from '@solvapay/auth/supabase';
 * 
 * const auth = new SupabaseAuthAdapter({
 *   jwtSecret: process.env.SUPABASE_JWT_SECRET!
 * });
 * 
 * const userId = await auth.getUserIdFromRequest(request);
 * if (!userId) {
 *   return new Response('Unauthorized', { status: 401 });
 * }
 * ```
 */
export class SupabaseAuthAdapter implements AuthAdapter {
  private jwtSecret: Uint8Array;

  constructor(config: SupabaseAuthAdapterConfig) {
    if (!config.jwtSecret) {
      throw new Error('SupabaseAuthAdapter requires jwtSecret in config');
    }
    this.jwtSecret = new TextEncoder().encode(config.jwtSecret);
  }

  async getUserIdFromRequest(req: Request | RequestLike): Promise<string | null> {
    try {
      const headers = 'headers' in req ? req.headers : req;
      const authHeader = headers.get('authorization');
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
      }

      const token = authHeader.slice(7);
      if (!token) {
        return null;
      }

      // Dynamic import to avoid requiring jose if not used (Edge-compatible)
      const { jwtVerify } = await import('jose');
      
      const { payload } = await jwtVerify(token, this.jwtSecret, {
        algorithms: ['HS256']
      });

      // Extract user ID from 'sub' claim (Supabase standard)
      const userId = payload.sub ? String(payload.sub) : null;
      return userId;

    } catch {
      // Return null on any error (invalid token, expired, etc.)
      // Never throw - let the caller decide how to handle unauthenticated requests
      return null;
    }
  }
}

