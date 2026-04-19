import { NextResponse } from 'next/server'
import type { SolvaPay } from '@solvapay/server'
import { listPlansCore, isErrorResult } from '@solvapay/server'

type ListPlansSuccess = Exclude<Awaited<ReturnType<typeof listPlansCore>>, { error: string }>

/**
 * Next.js Plans Helper
 */

export async function listPlans(
  request: globalThis.Request,
  options: {
    solvaPay?: SolvaPay
  } = {},
): Promise<ListPlansSuccess | NextResponse> {
  const result = await listPlansCore(request, options)

  if (isErrorResult(result)) {
    return NextResponse.json(
      { error: result.error, details: result.details },
      { status: result.status },
    )
  }

  return result
}
