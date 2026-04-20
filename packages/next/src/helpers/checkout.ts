import type { NextResponse } from 'next/server'
import type { SolvaPay } from '@solvapay/server'
import {
  createCheckoutSessionCore,
  createCustomerSessionCore,
} from '@solvapay/server'
import { toNextRouteResponse } from './_response'

/**
 * Next.js Checkout Helpers
 */

/**
 * Next.js route wrapper for POST /api/create-checkout-session.
 *
 * @example
 * ```ts
 * // app/api/create-checkout-session/route.ts
 * import { createCheckoutSession } from '@solvapay/next/helpers'
 *
 * export async function POST(request: Request) {
 *   const { productRef, planRef } = await request.json()
 *   return createCheckoutSession(request, { productRef, planRef })
 * }
 * ```
 */
export async function createCheckoutSession(
  request: globalThis.Request,
  body: {
    productRef: string
    planRef?: string
    returnUrl?: string
  },
  options: {
    solvaPay?: SolvaPay
    includeEmail?: boolean
    includeName?: boolean
    returnUrl?: string
  } = {},
): Promise<NextResponse> {
  const result = await createCheckoutSessionCore(request, body, options)
  return toNextRouteResponse(result)
}

/**
 * Next.js route wrapper for POST /api/create-customer-session.
 *
 * @example
 * ```ts
 * // app/api/create-customer-session/route.ts
 * import { createCustomerSession } from '@solvapay/next/helpers'
 * export const POST = (request: Request) => createCustomerSession(request)
 * ```
 */
export async function createCustomerSession(
  request: globalThis.Request,
  options: {
    solvaPay?: SolvaPay
    includeEmail?: boolean
    includeName?: boolean
  } = {},
): Promise<NextResponse> {
  const result = await createCustomerSessionCore(request, options)
  return toNextRouteResponse(result)
}
