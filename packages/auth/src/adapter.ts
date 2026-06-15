/**
 * Auth Adapter Interface
 *
 * Defines the contract for authentication adapters that extract user IDs from requests.
 * Implementations should never throw - return null if authentication fails or is missing.
 */

/**
 * Request-like object that has headers
 */
export interface RequestLike {
  headers:
    | Headers
    | {
        get(name: string): string | null
      }
}

/**
 * Resolved server-side identity for downstream SolvaPay handlers.
 */
export interface ServerIdentity {
  /** Stable user identifier (e.g. Auth0 `sub`). */
  userId: string
  /** Optional OIDC ID token forwarded as Bearer for email/name on customer create. */
  claimsToken?: string
}

/**
 * Result of an optional provider-owned middleware pre-step (`handleRequest`).
 */
export interface AuthRequestHandleResult {
  /** When `ownsRequest` is true, return this response immediately. */
  response?: Response
  /** Provider middleware response whose Set-Cookie headers should be merged. */
  sessionResponse?: Response
  /** When true, `response` is the final answer (e.g. `/auth/*` routes). */
  ownsRequest?: boolean
}

/**
 * Authentication adapter interface for extracting user IDs from requests.
 *
 * This interface defines the contract for authentication adapters that can
 * extract user IDs from various authentication systems (Supabase, custom JWT,
 * session-based auth, etc.). Adapters should never throw - return null if
 * authentication fails or is missing.
 *
 * @example
 * ```typescript
 * import type { AuthAdapter } from '@solvapay/auth';
 *
 * // Custom adapter implementation
 * const myAdapter: AuthAdapter = {
 *   async getUserIdFromRequest(req) {
 *     // Extract user ID from request (JWT, session, etc.)
 *     const token = req.headers.get('authorization')?.replace('Bearer ', '');
 *     if (!token) return null;
 *
 *     // Validate and extract user ID
 *     const payload = await verifyToken(token);
 *     return payload.userId || null;
 *   }
 * };
 * ```
 *
 * @see SupabaseAuthAdapter (from `@solvapay/auth/supabase`) for Supabase implementation
 * @see {@link MockAuthAdapter} for testing implementation
 * @since 1.0.0
 */
export interface AuthAdapter {
  /**
   * Extract the authenticated user ID from a request.
   *
   * This method should:
   * - Never throw exceptions (return null on failure)
   * - Handle missing/invalid authentication gracefully
   * - Work with both Request objects and objects with headers
   *
   * @param req - Request object or object with headers
   * @returns The user ID string if authenticated, null otherwise
   *
   * @remarks
   * This method should never throw. If authentication fails or is missing,
   * return null and let the caller decide how to handle unauthenticated requests.
   */
  getUserIdFromRequest(req: Request | RequestLike): Promise<string | null>

  /**
   * Optional richer identity resolution (user id + claims token).
   *
   * When absent, middleware falls back to `getUserIdFromRequest`.
   */
  getIdentityFromRequest?(req: Request | RequestLike): Promise<ServerIdentity | null>

  /**
   * Optional provider-owned request handling (session refresh, auth routes).
   *
   * When absent, middleware skips the pre-step.
   */
  handleRequest?(req: Request): Promise<AuthRequestHandleResult | null>
}
