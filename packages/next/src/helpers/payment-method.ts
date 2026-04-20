import type { NextResponse } from 'next/server'
import type { SolvaPay } from '@solvapay/server'
import { getPaymentMethodCore } from '@solvapay/server'
import { toNextRouteResponse } from './_response'

/**
 * Next.js route wrapper around `getPaymentMethodCore`.
 *
 * @example
 * ```ts
 * // app/api/payment-method/route.ts
 * import { getPaymentMethod } from '@solvapay/next/helpers'
 * export const GET = (request: Request) => getPaymentMethod(request)
 * ```
 */
export async function getPaymentMethod(
  request: globalThis.Request,
  options: {
    solvaPay?: SolvaPay
    includeEmail?: boolean
    includeName?: boolean
  } = {},
): Promise<NextResponse> {
  const result = await getPaymentMethodCore(request, options)
  return toNextRouteResponse(result)
}
