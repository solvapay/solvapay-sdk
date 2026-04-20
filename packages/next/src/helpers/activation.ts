import type { NextResponse } from 'next/server'
import type { SolvaPay } from '@solvapay/server'
import { activatePlanCore, isErrorResult } from '@solvapay/server'
import { toNextRouteResponse } from './_response'
import { invalidatePurchaseCacheForRequest } from './_cache'

/**
 * Next.js route wrapper for POST /api/activate-plan.
 *
 * Clears the purchase cache for the authenticated user on success so the
 * next `checkPurchase` sees the new plan immediately.
 *
 * @example
 * ```ts
 * // app/api/activate-plan/route.ts
 * import { activatePlan } from '@solvapay/next/helpers'
 *
 * export async function POST(request: Request) {
 *   const { productRef, planRef } = await request.json()
 *   return activatePlan(request, { productRef, planRef })
 * }
 * ```
 */
export async function activatePlan(
  request: globalThis.Request,
  body: {
    productRef: string
    planRef: string
  },
  options: {
    solvaPay?: SolvaPay
    includeEmail?: boolean
    includeName?: boolean
  } = {},
): Promise<NextResponse> {
  const result = await activatePlanCore(request, body, options)
  if (!isErrorResult(result)) {
    await invalidatePurchaseCacheForRequest(request)
  }
  return toNextRouteResponse(result)
}
