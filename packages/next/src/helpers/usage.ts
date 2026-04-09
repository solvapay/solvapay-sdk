import { NextResponse } from 'next/server'
import type { SolvaPay } from '@solvapay/server'
import { getAuthenticatedUserCore, isErrorResult, createSolvaPay } from '@solvapay/server'

export async function trackUsage(
  request: globalThis.Request,
  body: {
    actionType?: string
    units?: number
    productRef?: string
    description?: string
    metadata?: Record<string, unknown>
  },
  options: {
    solvaPay?: SolvaPay
  } = {},
): Promise<NextResponse> {
  try {
    const userResult = await getAuthenticatedUserCore(request)

    if (isErrorResult(userResult)) {
      return NextResponse.json(
        { error: userResult.error, details: userResult.details },
        { status: userResult.status },
      )
    }

    const { userId, email, name } = userResult

    const solvaPay = options.solvaPay || createSolvaPay()

    const customerRef = await solvaPay.ensureCustomer(userId, userId, {
      email: email || undefined,
      name: name || undefined,
    })

    await solvaPay.trackUsage({
      customerRef,
      actionType: body.actionType as any,
      units: body.units,
      productRef: body.productRef,
      description: body.description,
      metadata: body.metadata,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[trackUsage] Error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: 'Track usage failed', details: message },
      { status: 500 },
    )
  }
}
