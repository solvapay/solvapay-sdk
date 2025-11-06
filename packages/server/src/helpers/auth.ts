/**
 * Authentication Helper (Core)
 * 
 * Generic helper for extracting authenticated user information from requests.
 * Works with standard Web API Request (works everywhere).
 */

import type { AuthenticatedUser, ErrorResult } from './types';
import { handleRouteError } from './error';

/**
 * Extract authenticated user information from a standard Web API Request.
 * 
 * This is a generic, framework-agnostic helper that extracts user ID, email,
 * and name from authenticated requests. Works with any framework that uses
 * the standard Web API Request (Express, Fastify, Next.js, Edge Functions, etc.).
 * 
 * Uses dynamic imports to avoid requiring @solvapay/auth at build time,
 * making it suitable for edge runtime environments.
 * 
 * @param request - Standard Web API Request object
 * @param options - Configuration options
 * @param options.includeEmail - Whether to extract email from JWT token (default: true)
 * @param options.includeName - Whether to extract name from JWT token (default: true)
 * @returns Authenticated user info or error result
 * 
 * @example
 * ```typescript
 * // In an API route handler
 * export async function GET(request: Request) {
 *   const userResult = await getAuthenticatedUserCore(request);
 *   
 *   if (isErrorResult(userResult)) {
 *     return Response.json(userResult, { status: userResult.status });
 *   }
 *   
 *   const { userId, email, name } = userResult;
 *   // Use user info...
 * }
 * ```
 * 
 * @see {@link AuthenticatedUser} for the return type
 * @see {@link ErrorResult} for error handling
 * @since 1.0.0
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

