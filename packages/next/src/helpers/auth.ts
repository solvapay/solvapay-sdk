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
 * Get authenticated user - Next.js wrapper
 * 
 * @param request - Next.js request object
 * @param options - Configuration options
 * @returns Authenticated user info or NextResponse error
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

