import { NextResponse } from 'next/server'
import { listPlansCore, isErrorResult } from '@solvapay/server'

/**
 * Next.js Plans Helper
 *
 * Next.js-specific wrapper for plans helper.
 * This is a public route - no authentication required.
 */

/**
 * List plans - Next.js wrapper
 *
 * @param request - Next.js request object
 * @returns Plans response or NextResponse error
 */
export async function listPlans(request: globalThis.Request): Promise<
  | {
      plans: Array<Record<string, unknown>>
      agentRef: string
    }
  | NextResponse
> {
  const result = await listPlansCore(request)

  if (isErrorResult(result)) {
    return NextResponse.json(
      { error: result.error, details: result.details },
      { status: result.status },
    )
  }

  return result
}
