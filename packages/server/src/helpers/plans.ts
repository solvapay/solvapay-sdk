/**
 * Plans Helper (Core)
 *
 * Generic helper for listing plans.
 * Works with standard Web API Request (works everywhere).
 * This is a public route - no authentication required.
 */

import type { ErrorResult } from './types'
import type { components } from '../types/generated'
import type { SolvaPay } from '../factory'
import { createSolvaPayClient } from '../client'
import { handleRouteError } from './error'
import { getSolvaPayConfig } from '@solvapay/core'

type Plan = components['schemas']['Plan']

/**
 * List plans - core implementation.
 *
 * Pass `options.solvaPay` to route through a pre-configured SolvaPay instance
 * (e.g. stub-backed in examples). When omitted, the helper reads
 * `SOLVAPAY_SECRET_KEY` from environment and constructs a real API client.
 */
export async function listPlansCore(
  request: Request,
  options: {
    solvaPay?: SolvaPay
  } = {},
): Promise<
  | {
      plans: Plan[]
      productRef: string
    }
  | ErrorResult
> {
  try {
    const url = new URL(request.url)
    const productRef = url.searchParams.get('productRef')

    if (!productRef) {
      return {
        error: 'Missing required parameter: productRef',
        status: 400,
      }
    }

    const apiClient = options.solvaPay?.apiClient ?? (() => {
      const config = getSolvaPayConfig()
      if (!config.apiKey) return null
      return createSolvaPayClient({
        apiKey: config.apiKey,
        apiBaseUrl: config.apiBaseUrl,
      })
    })()

    if (!apiClient) {
      return {
        error: 'Server configuration error: SolvaPay secret key not configured',
        status: 500,
      }
    }

    if (!apiClient.listPlans) {
      return {
        error: 'List plans method not available',
        status: 500,
      }
    }

    const plans = await apiClient.listPlans(productRef)

    return {
      plans: plans || [],
      productRef,
    }
  } catch (error) {
    return handleRouteError(error, 'List plans', 'Failed to fetch plans')
  }
}
