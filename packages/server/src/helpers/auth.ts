/**
 * Authentication Helper (Core)
 * 
 * Generic helper for extracting authenticated user information from requests.
 * Works with standard Web API Request (works everywhere).
 */

import type { AuthenticatedUser, ErrorResult } from './types';
import { handleRouteError } from './error';

/**
 * Extract authenticated user information from request
 * 
 * This is a generic implementation that uses dynamic imports to avoid
 * requiring @solvapay/auth package at build time.
 * 
 * @param request - Standard Web API Request
 * @param options - Configuration options
 * @returns Authenticated user info or error result
 */
export async function getAuthenticatedUserCore(
  request: Request,
  options: {
    includeEmail?: boolean;
    includeName?: boolean;
  } = {}
): Promise<AuthenticatedUser | ErrorResult> {
  try {
    // Dynamic import to avoid requiring auth package if not needed
    const { requireUserId, getUserEmailFromRequest, getUserNameFromRequest } = await import('@solvapay/auth');

    // Get userId from middleware/auth (set by middleware.ts or auth adapter)
    const userIdOrError = requireUserId(request);
    if (userIdOrError instanceof Response) {
      // Convert Response to ErrorResult
      const clonedResponse = userIdOrError.clone();
      const body = await clonedResponse.json().catch(() => ({ error: 'Unauthorized' }));
      return {
        error: body.error || 'Unauthorized',
        status: userIdOrError.status,
        details: body.error || 'Unauthorized',
      };
    }
    const userId = userIdOrError;

    // Get user email and name from JWT token if requested
    const email = options.includeEmail !== false 
      ? await getUserEmailFromRequest(request) 
      : null;
    const name = options.includeName !== false 
      ? await getUserNameFromRequest(request) 
      : null;

    return {
      userId,
      email,
      name,
    };
  } catch (error) {
    return handleRouteError(error, 'Get authenticated user', 'Authentication failed');
  }
}

