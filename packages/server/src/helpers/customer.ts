/**
 * Customer Helper (Core)
 * 
 * Generic helper for syncing customers with SolvaPay backend.
 * Works with standard Web API Request (works everywhere).
 */

import type { SolvaPay } from '../factory';
import type { ErrorResult } from './types';
import { createSolvaPay } from '../factory';
import { handleRouteError, isErrorResult } from './error';
import { getAuthenticatedUserCore } from './auth';

/**
 * Sync customer - ensure customer exists in SolvaPay backend
 * 
 * Uses externalRef for consistent lookup and prevents duplicate customers.
 * 
 * @param request - Standard Web API Request
 * @param options - Configuration options
 * @returns Customer reference or error result
 */
export async function syncCustomerCore(
  request: Request,
  options: {
    solvaPay?: SolvaPay;
    includeEmail?: boolean;
    includeName?: boolean;
  } = {}
): Promise<string | ErrorResult> {
  try {
    // Get authenticated user
    const userResult = await getAuthenticatedUserCore(request, {
      includeEmail: options.includeEmail,
      includeName: options.includeName,
    });

    if (isErrorResult(userResult)) {
      return userResult;
    }

    const { userId, email, name } = userResult;

    // Use provided SolvaPay instance or create new one
    const solvaPay = options.solvaPay || createSolvaPay();

    // Use userId as cache key (first param) and externalRef (second param)
    // The first parameter (customerRef) is used as a cache key
    // The second parameter (externalRef) is stored on the SolvaPay backend for customer lookup
    // This ensures consistent lookup and prevents duplicate customers
    // Pass email and name to ensure correct customer data
    // Note: Customer lookup deduplication is handled automatically by the SDK
    // The returned customerRef is the SolvaPay backend customer reference (different from Supabase user ID)
    const customerRef = await solvaPay.ensureCustomer(userId, userId, {
      email: email || undefined,
      name: name || undefined,
    });

    return customerRef;
  } catch (error) {
    return handleRouteError(error, 'Sync customer', 'Failed to sync customer');
  }
}

