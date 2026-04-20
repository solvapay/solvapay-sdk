import type { NextResponse } from 'next/server'
import type { SolvaPay } from '@solvapay/server'
import { trackUsageCore } from '@solvapay/server'
import { toNextRouteResponse } from './_response'

/**
 * Next.js route wrapper for POST /api/track-usage.
 *
 * @example
 * ```ts
 * // app/api/track-usage/route.ts
 * import { trackUsage } from '@solvapay/next/helpers'
 *
 * export async function POST(request: Request) {
 *   const body = await request.json()
 *   return trackUsage(request, body)
 * }
 * ```
 */
export async function trackUsage(
  request: globalThis.Request,
  body: {
    actionType?: 'transaction' | 'api_call' | 'hour' | 'email' | 'storage' | 'custom'
    units?: number
    productRef?: string
    description?: string
    metadata?: Record<string, unknown>
  },
  options: {
    solvaPay?: SolvaPay
  } = {},
): Promise<NextResponse> {
  const result = await trackUsageCore(request, body, options)
  return toNextRouteResponse(result)
}
