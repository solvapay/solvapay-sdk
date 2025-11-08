/**
 * Next.js Checkout Helpers
 *
 * Next.js-specific wrappers for checkout helpers.
 */

import { NextResponse } from 'next/server'
import type { SolvaPay } from '@solvapay/server'
import {
  createCheckoutSessionCore,
  createCustomerSessionCore,
  type ErrorResult,
  isErrorResult,
} from '@solvapay/server'

/**
 * Create checkout session - Next.js wrapper
 *
 * @param request - Next.js request object
 * @param body - Checkout session parameters
 * @param options - Configuration options
 * @returns Checkout session response or NextResponse error
 */
export async function createCheckoutSession(
  request: globalThis.Request,
  body: {
    agentRef: string
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

/**
 * Create customer session - Next.js wrapper
 *
 * @param request - Next.js request object
 * @param options - Configuration options
 * @returns Customer session response or NextResponse error
 */
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
