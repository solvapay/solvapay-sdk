/**
 * Limits Helper (Core)
 *
 * Generic helper for surfacing the customer's runtime allowance against a
 * (product, meter) pair. Backs the React `useLimits` hook over HTTP — the
 * same `LimitResponse` `paywall.decide()` consults internally on every gated
 * request, exposed read-only so consumers can render an honest "X left"
 * counter without reinventing the math client-side.
 */

import { resolveCheckLimitsParams } from '../native-decisions'
import type { SolvaPay } from '../factory'
import type { LimitResponseWithPlan } from '../types/client'
import type { ErrorResult } from './types'
import { createSolvaPay } from '../factory'
import { handleRouteError, isErrorResult } from './error'
import { getAuthenticatedUserCore } from './auth'

/**
 * Get the authenticated customer's runtime limits for a (product, meter) pair.
 *
 * Authenticates the request, ensures the customer exists (matching the same
 * resolution the paywall gate uses), then calls `solvaPay.checkLimits`. The
 * returned `LimitResponseWithPlan` mirrors the value the SDK consults on
 * every paywall gate, so the React side stays in lockstep with the backend's
 * authoritative remainder.
 *
 * Reads `productRef` (required) and `meterName` (optional, defaults to
 * `'requests'`) from the request's query string.
 *
 * @param request - Standard Web API Request object
 * @param options - Configuration options
 * @returns `LimitResponseWithPlan` or error result
 */
export async function checkLimitsCore(
  request: Request,
  options: {
    solvaPay?: SolvaPay
  } = {},
): Promise<LimitResponseWithPlan | ErrorResult> {
  try {
    const url = new URL(request.url)
    const resolved = resolveCheckLimitsParams(
      url.searchParams.get('productRef'),
      url.searchParams.get('meterName'),
    )

    if ('error' in resolved) {
      return resolved
    }

    const { productRef, meterName } = resolved

    const userResult = await getAuthenticatedUserCore(request)

    if (isErrorResult(userResult)) {
      return userResult
    }

    const { userId, email, name } = userResult

    const solvaPay = options.solvaPay || createSolvaPay()

    const customerRef = await solvaPay.ensureCustomer(userId, userId, {
      email: email || undefined,
      name: name || undefined,
    })

    // Reach through to `apiClient.checkLimits` (rather than the
    // factory's narrower `solvaPay.checkLimits`) so the helper returns
    // the full `LimitResponseWithPlan`. The factory shape doesn't carry
    // `activationRequired` / `plans` / `balance` / `product` — fields a
    // future consumer of `checkLimitsCore` may want even though the
    // initial `useLimits` projection only reads `withinLimits` /
    // `remaining` / `meterName`.
    const result = await solvaPay.apiClient.checkLimits({
      customerRef,
      productRef,
      meterName,
    })

    return result
  } catch (error) {
    return handleRouteError(error, 'Check limits', 'Failed to check limits')
  }
}
