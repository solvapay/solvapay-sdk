/**
 * Next.js Authentication Helpers
 * 
 * Next.js-specific wrappers for authentication helpers.
 */

import { NextResponse } from 'next/server';
import {
  getAuthenticatedUserCore,
  type AuthenticatedUser,
  type ErrorResult,
  isErrorResult,
} from '@solvapay/server';

/**
 * Get authenticated user information from a Next.js request.
 * 
 * This is a Next.js-specific wrapper around `getAuthenticatedUserCore` that
 * returns NextResponse for errors instead of ErrorResult. Extracts user ID,
 * email, and name from authenticated requests.
 * 
 * @param request - Next.js request object (NextRequest or Request)
 * @param options - Configuration options
 * @param options.includeEmail - Whether to extract email from JWT token (default: true)
 * @param options.includeName - Whether to extract name from JWT token (default: true)
 * @returns Authenticated user info or NextResponse error
 * 
 * @example
 * ```typescript
 * import { NextRequest, NextResponse } from 'next/server';
 * import { getAuthenticatedUser } from '@solvapay/next';
 * 
 * export async function GET(request: NextRequest) {
 *   const userResult = await getAuthenticatedUser(request);
 *   
 *   if (userResult instanceof NextResponse) {
 *     return userResult; // Error response
 *   }
 *   
 *   const { userId, email, name } = userResult;
 *   return NextResponse.json({ userId, email, name });
 * }
 * ```
 * 
 * @see {@link getAuthenticatedUserCore} for the core implementation
 * @since 1.0.0
 */
export async function getAuthenticatedUser(
  request: globalThis.Request,
  options: {
    includeEmail?: boolean;
    includeName?: boolean;
  } = {}
): Promise<AuthenticatedUser | NextResponse> {
  const result = await getAuthenticatedUserCore(request, options);
  
  if (isErrorResult(result)) {
    return NextResponse.json(
      { error: result.error, details: result.details },
      { status: result.status }
    );
  }
  
  return result;
}

