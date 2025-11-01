/**
 * Mock Auth Adapter
 * 
 * Simple adapter for testing and examples that extracts user ID from headers
 * or environment variables. No dependencies required.
 */

import type { AuthAdapter, RequestLike } from './adapter';

/**
 * Mock authentication adapter
 * 
 * Extracts user ID from `x-mock-user-id` header or `MOCK_USER_ID` environment variable.
 * Useful for testing, examples, and development where real authentication isn't needed.
 * 
 * @example
 * ```ts
 * import { MockAuthAdapter } from '@solvapay/auth/mock';
 * 
 * const auth = new MockAuthAdapter();
 * 
 * // In tests or examples:
 * // Set header: x-mock-user-id: user_123
 * // Or set env: MOCK_USER_ID=user_123
 * 
 * const userId = await auth.getUserIdFromRequest(request);
 * ```
 */
export class MockAuthAdapter implements AuthAdapter {
  async getUserIdFromRequest(req: Request | RequestLike): Promise<string | null> {
    const headers = 'headers' in req ? req.headers : req;
    
    // First try to get from header
    const headerUserId = headers.get('x-mock-user-id');
    if (headerUserId) {
      return headerUserId;
    }

    // Fallback to environment variable (only in Node.js runtime)
    if (typeof process !== 'undefined' && process.env.MOCK_USER_ID) {
      return process.env.MOCK_USER_ID;
    }

    return null;
  }
}

