import { NextResponse } from 'next/server'
import type { SolvaPay } from '@solvapay/server'
import { trackUsageCore, isErrorResult } from '@solvapay/server'

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

  if (isErrorResult(result)) {
    return NextResponse.json(
      { error: result.error, details: result.details },
      { status: result.status },
    )
  }

  return NextResponse.json(result)
}
