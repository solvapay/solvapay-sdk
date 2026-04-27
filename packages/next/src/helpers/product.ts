import type { NextResponse } from 'next/server'
import type { SolvaPay } from '@solvapay/server'
import { getProductCore } from '@solvapay/server'
import { toNextRouteResponse } from './_response'

/**
 * Next.js route wrapper for GET /api/get-product?productRef=...
 *
 * @example
 * ```ts
 * // app/api/get-product/route.ts
 * import { getProduct } from '@solvapay/next/helpers'
 * export const GET = (request: Request) => getProduct(request)
 * ```
 */
export async function getProduct(
  request: globalThis.Request,
  options: {
    solvaPay?: SolvaPay
  } = {},
): Promise<NextResponse> {
  const result = await getProductCore(request, options)
  return toNextRouteResponse(result)
}
