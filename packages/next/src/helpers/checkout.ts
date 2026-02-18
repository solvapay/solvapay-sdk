/**
 * Next.js Checkout Helpers
 */

import { NextResponse } from 'next/server'
import type { SolvaPay } from '@solvapay/server'
import {
  createCheckoutSessionCore,
  createCustomerSessionCore,
  isErrorResult,
} from '@solvapay/server'

export async function createCheckoutSession(
  request: globalThis.Request,
  body: {
    productRef: string
    planRef?: string
    returnUrl?: string
  },
  options: {
    solvaPay?: SolvaPay
    includeEmail?: boolean
    includeName?: boolean
    returnUrl?: string
  } = {},
): Promise<
  | {
      sessionId: string
      checkoutUrl: string
    }
  | NextResponse
> {
  const result = await createCheckoutSessionCore(request, body, options)

  if (isErrorResult(result)) {
    return NextResponse.json(
      { error: result.error, details: result.details },
      { status: result.status },
    )
  }

  return result
}

export async function createCustomerSession(
  request: globalThis.Request,
  options: {
    solvaPay?: SolvaPay
    includeEmail?: boolean
    includeName?: boolean
  } = {},
): Promise<
  | {
      sessionId: string
      customerUrl: string
    }
  | NextResponse
> {
  const result = await createCustomerSessionCore(request, options)

  if (isErrorResult(result)) {
    return NextResponse.json(
      { error: result.error, details: result.details },
      { status: result.status },
    )
  }

  return result
}
