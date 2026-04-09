/**
 * Next.js Customer Helpers
 *
 * Next.js-specific wrappers for customer helpers.
 */

import { NextResponse } from 'next/server'
import type { SolvaPay, CustomerBalanceResult } from '@solvapay/server'
import { syncCustomerCore, getCustomerBalanceCore, isErrorResult } from '@solvapay/server'

/**
 * Sync customer - Next.js wrapper
 *
 * @param request - Next.js request object
 * @param options - Configuration options
 * @returns Customer reference or NextResponse error
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
 * Get customer credits - Next.js wrapper
 *
 * @param request - Next.js request object
 * @param options - Configuration options
 * @returns Customer credits result or NextResponse error
 */
export async function getCustomerBalance(
  request: globalThis.Request,
  options: {
    solvaPay?: SolvaPay
  } = {},
): Promise<CustomerBalanceResult | NextResponse> {
  const result = await getCustomerBalanceCore(request, options)

  if (isErrorResult(result)) {
    return NextResponse.json(
      { error: result.error, details: result.details },
      { status: result.status },
    )
  }

  return result
}
