import type { NextResponse } from 'next/server'
import type { SolvaPay } from '@solvapay/server'
import { listPlansCore } from '@solvapay/server'
import { toNextRouteResponse } from './_response'

/**
 * Next.js route wrapper for GET /api/list-plans?productRef=...
 *
 * @example
 * ```ts
 * // app/api/list-plans/route.ts
 * import { listPlans } from '@solvapay/next/helpers'
 * export const GET = (request: Request) => listPlans(request)
 * ```
 */
export async function listPlans(
  request: globalThis.Request,
  options: {
    solvaPay?: SolvaPay
  } = {},
): Promise<NextResponse> {
  const result = await listPlansCore(request, options)
  return toNextRouteResponse(result)
}
