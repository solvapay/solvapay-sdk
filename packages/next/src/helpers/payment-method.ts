import type { NextResponse } from 'next/server'
import type { SolvaPay } from '@solvapay/server'
import { getPaymentMethodCore, removePaymentMethodCore } from '@solvapay/server'
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

/**
 * Next.js route wrapper around `removePaymentMethodCore`: removes the
 * customer's card on file and returns `{ removed, autoRechargePaused }`.
 *
 * @example
 * ```ts
 * // app/api/payment-method/route.ts
 * import { getPaymentMethod, removePaymentMethod } from '@solvapay/next/helpers'
 * export const GET = (request: Request) => getPaymentMethod(request)
 * export const DELETE = (request: Request) => removePaymentMethod(request)
 * ```
 */
export async function removePaymentMethod(
  request: globalThis.Request,
  options: {
    solvaPay?: SolvaPay
    includeEmail?: boolean
    includeName?: boolean
  } = {},
): Promise<NextResponse> {
  const result = await removePaymentMethodCore(request, options)
  return toNextRouteResponse(result)
}
