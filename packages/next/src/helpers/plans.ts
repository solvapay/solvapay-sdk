import { NextResponse } from 'next/server'
import { listPlansCore, isErrorResult } from '@solvapay/server'

/**
 * Next.js Plans Helper
 */

export async function listPlans(request: globalThis.Request): Promise<
  | {
      plans: Array<Record<string, unknown>>
      productRef: string
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
