/**
 * Next.js Customer Helpers
 *
 * Next.js-specific wrappers for customer helpers.
 */

import { NextResponse } from 'next/server'
import type { SolvaPay } from '@solvapay/server'
import { syncCustomerCore, getCustomerBalanceCore, isErrorResult } from '@solvapay/server'
import { toNextRouteResponse } from './_response'

/**
 * Get the authenticated customer's SolvaPay reference.
 *
 * Unlike the other route-wrapper helpers, this one returns the raw customer
 * reference string on success so callers can use it to build their own
 * response body. Errors are still returned as a `NextResponse`.
 *
 * @example
 * ```ts
 * // app/api/sync-customer/route.ts
 * import { NextResponse } from 'next/server'
 * import { syncCustomer } from '@solvapay/next/helpers'
 *
 * export async function POST(request: Request) {
 *   const result = await syncCustomer(request)
 *   if (result instanceof NextResponse) return result
 *   return NextResponse.json({ customerRef: result })
 * }
 * ```
 */
export async function syncCustomer(
  request: globalThis.Request,
  options: {
    solvaPay?: SolvaPay
    includeEmail?: boolean
    includeName?: boolean
  } = {},
): Promise<string | NextResponse> {
  const result = await syncCustomerCore(request, options)

  if (isErrorResult(result)) {
    return NextResponse.json(
      { error: result.error, details: result.details },
      { status: result.status },
    )
  }

  return result
}

/**
 * Next.js route wrapper for GET /api/customer-balance.
 *
 * @example
 * ```ts
 * // app/api/customer-balance/route.ts
 * import { getCustomerBalance } from '@solvapay/next/helpers'
 * export const GET = (request: Request) => getCustomerBalance(request)
 * ```
 */
export async function getCustomerBalance(
  request: globalThis.Request,
  options: {
    solvaPay?: SolvaPay
  } = {},
): Promise<NextResponse> {
  const result = await getCustomerBalanceCore(request, options)
  return toNextRouteResponse(result)
}
