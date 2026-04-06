import { NextResponse } from 'next/server'
import type { SolvaPay, ActivatePlanResult } from '@solvapay/server'
import { activatePlanCore, isErrorResult } from '@solvapay/server'
import { clearPurchaseCache } from '../cache'
import { getAuthenticatedUserCore } from '@solvapay/server'

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
): Promise<ActivatePlanResult | NextResponse> {
  const result = await activatePlanCore(request, body, options)

  if (isErrorResult(result)) {
    return NextResponse.json(
      { error: result.error, details: result.details },
      { status: result.status },
    )
  }

  try {
    const userResult = await getAuthenticatedUserCore(request)
    if (!isErrorResult(userResult)) {
      clearPurchaseCache(userResult.userId)
    }
  } catch {
    // Ignore errors in cache clearing
  }

  return result
}
