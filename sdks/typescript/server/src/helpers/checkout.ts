/**
 * Checkout Helpers (Core)
 *
 * Generic helpers for checkout session operations.
 * Works with standard Web API Request (works everywhere).
 */

import { resolveReturnUrl, validateCheckoutSessionParams } from '../native-decisions'
import type { SolvaPay } from '../factory'
import type { ErrorResult } from './types'
import { createSolvaPay } from '../factory'
import { handleRouteError, isErrorResult } from './error'
import { syncCustomerCore } from './customer'

/**
 * Create checkout session - core implementation
 *
 * @param request - Standard Web API Request
 * @param body - Checkout session parameters
 * @param options - Configuration options
 * @returns Checkout session response or error result
 */
export async function createCheckoutSessionCore(
  request: Request,
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
  | ErrorResult
> {
  try {
    const validationError = validateCheckoutSessionParams(body.productRef)
    if (validationError) {
      return validationError
    }

    const customerResult = await syncCustomerCore(request, {
      solvaPay: options.solvaPay,
      includeEmail: options.includeEmail,
      includeName: options.includeName,
    })

    if (isErrorResult(customerResult)) {
      return customerResult
    }

    const customerRef = customerResult

    let origin: string | null = null
    try {
      origin = new URL(request.url).origin
    } catch {
      // If URL parsing fails, continue without origin fallback
    }

    const returnUrl = resolveReturnUrl(body.returnUrl, options.returnUrl, origin)

    const solvaPay = options.solvaPay || createSolvaPay()

    const session = await solvaPay.createCheckoutSession({
      productRef: body.productRef,
      customerRef,
      planRef: body.planRef || undefined,
      returnUrl: returnUrl,
    })

    return {
      sessionId: session.sessionId,
      checkoutUrl: session.checkoutUrl,
    }
  } catch (error) {
    return handleRouteError(error, 'Create checkout session', 'Checkout session creation failed')
  }
}

/**
 * Create customer session - core implementation
 *
 * @param request - Standard Web API Request
 * @param options - Configuration options
 * @returns Customer session response or error result
 */
export async function createCustomerSessionCore(
  request: Request,
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
  | ErrorResult
> {
  try {
    const customerResult = await syncCustomerCore(request, {
      solvaPay: options.solvaPay,
      includeEmail: options.includeEmail,
      includeName: options.includeName,
    })

    if (isErrorResult(customerResult)) {
      return customerResult
    }

    const customerRef = customerResult

    const solvaPay = options.solvaPay || createSolvaPay()

    const session = await solvaPay.createCustomerSession({
      customerRef,
    })

    return session
  } catch (error) {
    return handleRouteError(error, 'Create customer session', 'Customer session creation failed')
  }
}
