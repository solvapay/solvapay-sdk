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
  headers: Headers | {
    get(name: string): string | null;
  };
}

/**
 * Auth adapter interface for extracting user IDs from requests
 */
export interface AuthAdapter {
  /**
   * Extract the authenticated user ID from a request
   * 
   * @param req - Request object or object with headers
   * @returns The user ID string if authenticated, null otherwise
   * 
   * @remarks
   * This method should never throw. If authentication fails or is missing,
   * return null and let the caller decide how to handle unauthenticated requests.
   */
  getUserIdFromRequest(req: Request | RequestLike): Promise<string | null>;
}

