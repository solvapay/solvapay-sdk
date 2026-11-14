/**
 * Customer Helper (Core)
 *
 * Generic helper for syncing customers with SolvaPay backend.
 * Works with standard Web API Request (works everywhere).
 */

import type { SolvaPay } from '../factory'
import type { ErrorResult } from './types'
import { createSolvaPay } from '../factory'
import { handleRouteError, isErrorResult } from './error'
import { getAuthenticatedUserCore } from './auth'
import { resolveCallerCustomer } from './caller'

import type { components } from '../types/generated'

export type CustomerBalanceResult = components['schemas']['CustomerBalanceResponse']

/**
 * Sync customer with SolvaPay backend (ensure customer exists).
 *
 * This helper ensures a customer exists in the SolvaPay backend by:
 * 1. Extracting authenticated user information from the request
 * 2. Creating or retrieving the customer using the user ID as external reference
 * 3. Syncing customer data (email, name) if provided
 *
 * Uses `externalRef` for consistent lookup and prevents duplicate customers.
 * The returned customer reference is the SolvaPay backend customer ID.
 *
 * @param request - Standard Web API Request object
 * @param options - Configuration options
 * @param options.solvaPay - Optional SolvaPay instance (creates new one if not provided)
 * @param options.includeEmail - Whether to include email in customer data (default: true)
 * @param options.includeName - Whether to include name in customer data (default: true)
 * @returns Customer reference (backend customer ID) or error result
 *
 * @example
 * ```typescript
 * // In an API route handler
 * export async function POST(request: Request) {
 *   const customerResult = await syncCustomerCore(request);
 *
 *   if (isErrorResult(customerResult)) {
 *     return Response.json(customerResult, { status: customerResult.status });
 *   }
 *
 *   const customerRef = customerResult;
 *   // Use customer reference...
 * }
 * ```
 *
 * @see {@link getAuthenticatedUserCore} for user extraction
 * @see {@link ErrorResult} for error handling
 * @since 1.0.0
 */
export async function syncCustomerCore(
  request: Request,
  options: {
    solvaPay?: SolvaPay
    includeEmail?: boolean
    includeName?: boolean
  } = {},
): Promise<string | ErrorResult> {
  try {
    // Get authenticated user
    const userResult = await getAuthenticatedUserCore(request, {
      includeEmail: options.includeEmail,
      includeName: options.includeName,
    })

    if (isErrorResult(userResult)) {
      return userResult
    }

    const { userId, email, name } = userResult

    // Use provided SolvaPay instance or create new one
    const solvaPay = options.solvaPay || createSolvaPay()

    // The web routes' user is looked up by externalRef; a request server code
    // marked with withCustomerRef (the MCP widget tools) acts for that customer.
    const customerRef = await resolveCallerCustomer(request, solvaPay, { userId, email, name })

    return customerRef
  } catch (error) {
    return handleRouteError(error, 'Sync customer', 'Failed to sync customer')
  }
}

/**
 * Get credits for the authenticated customer.
 *
 * Authenticates the request, syncs the customer, then fetches credits.
 *
 * @param request - Standard Web API Request object
 * @param options - Configuration options
 * @returns Customer credits result or error result
 */
export async function getCustomerBalanceCore(
  request: Request,
  options: {
    solvaPay?: SolvaPay
  } = {},
): Promise<CustomerBalanceResult | ErrorResult> {
  try {
    const userResult = await getAuthenticatedUserCore(request)

    if (isErrorResult(userResult)) {
      return userResult
    }

    const { userId, email, name } = userResult

    const solvaPay = options.solvaPay || createSolvaPay()

    const customerRef = await resolveCallerCustomer(request, solvaPay, { userId, email, name })

    const result = await solvaPay.getCustomerBalance({ customerRef })

    return result
  } catch (error) {
    return handleRouteError(error, 'Get customer credits', 'Failed to get customer credits')
  }
}
