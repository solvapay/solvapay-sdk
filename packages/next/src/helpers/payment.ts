/**
 * Next.js Payment Helpers
 */

import { NextResponse } from 'next/server'
import type { SolvaPay } from '@solvapay/server'
import {
  createPaymentIntentCore,
  processPaymentIntentCore,
  isErrorResult,
} from '@solvapay/server'
import { clearPurchaseCache } from '../cache'
import { getAuthenticatedUserCore } from '@solvapay/server'

export async function createPaymentIntent(
  request: globalThis.Request,
  body: {
    planRef: string
    productRef: string
  },
  options: {
    solvaPay?: SolvaPay
    includeEmail?: boolean
    includeName?: boolean
  } = {},
): Promise<
  | {
      id: string
      clientSecret: string
      publishableKey: string
      accountId?: string
      customerRef: string
    }
  | NextResponse
> {
  const result = await createPaymentIntentCore(request, body, options)

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

export async function processPaymentIntent(
  request: globalThis.Request,
  body: {
    paymentIntentId: string
    productRef: string
    planRef?: string
  },
  options: {
    solvaPay?: SolvaPay
  } = {},
): Promise<import('@solvapay/server').ProcessPaymentResult | NextResponse> {
  const result = await processPaymentIntentCore(request, body, options)

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
