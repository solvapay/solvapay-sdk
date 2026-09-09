/**
 * Checkout Helpers (Core)
 *
 * Generic helpers for checkout session operations.
 * Works with standard Web API Request (works everywhere).
 */

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
    /**
     * URL to send the customer back to after payment. Pass `null` to omit
     * the field entirely — skips `options.returnUrl` and the request-origin
     * fallback. Use this when the caller has no browsable page to return to
     * (MCP servers whose public URL is an API endpoint, not a website).
     */
    returnUrl?: string | null
    purpose?: 'credit_topup'
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
    if (!body.productRef) {
      return {
        error: 'Missing required parameter: productRef is required',
        status: 400,
      }
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

    let returnUrl: string | undefined
    if (body.returnUrl !== null) {
      returnUrl = body.returnUrl || options.returnUrl
      if (!returnUrl) {
        try {
          const url = new URL(request.url)
          returnUrl = url.origin
        } catch {
          // If URL parsing fails, continue without returnUrl
        }
      }
    }

    const solvaPay = options.solvaPay || createSolvaPay()

    const session = await solvaPay.createCheckoutSession({
      productRef: body.productRef,
      customerRef,
      planRef: body.planRef || undefined,
      ...(returnUrl ? { returnUrl } : {}),
      ...(body.purpose ? { purpose: body.purpose } : {}),
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
