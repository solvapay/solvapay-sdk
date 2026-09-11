import { NextResponse } from 'next/server'
import { isErrorResult } from '@solvapay/server'
import type { ErrorResult } from '@solvapay/server'

/**
 * Wraps a `*Core` helper result into a `NextResponse`.
 *
 * - `ErrorResult` → `NextResponse.json({ error, details }, { status })`.
 * - Anything else → `NextResponse.json(result)`.
 *
 * Lets each route-wrapper helper in `@solvapay/next/helpers` collapse to a
 * single line and always return `Promise<NextResponse>`, so callers can use
 * them as drop-in App Router handlers:
 *
 * ```ts
 * export const GET = (req: Request) => getMerchant(req)
 * ```
 */
export function toNextRouteResponse<T>(result: T | ErrorResult): NextResponse {
  if (isErrorResult(result)) {
    return NextResponse.json(
      { error: result.error, details: result.details },
      { status: result.status },
    )
  }
  return NextResponse.json(result)
}
