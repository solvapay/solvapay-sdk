import type { NextResponse } from 'next/server'
import type { SolvaPay } from '@solvapay/server'
import { getMerchantCore } from '@solvapay/server'
import { toNextRouteResponse } from './_response'

/**
 * Next.js route wrapper for GET /api/merchant.
 *
 * @example
 * ```ts
 * // app/api/merchant/route.ts
 * import { getMerchant } from '@solvapay/next/helpers'
 * export const GET = (request: Request) => getMerchant(request)
 * ```
 */
export async function getMerchant(
  request: globalThis.Request,
  options: {
    solvaPay?: SolvaPay
  } = {},
): Promise<NextResponse> {
  const result = await getMerchantCore(request, options)
  return toNextRouteResponse(result)
}
