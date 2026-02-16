/**
 * Plans Helper (Core)
 *
 * Generic helper for listing plans.
 * Works with standard Web API Request (works everywhere).
 * This is a public route - no authentication required.
 */

import type { ErrorResult } from './types'
import { createSolvaPayClient } from '../client'
import { handleRouteError } from './error'
import { getSolvaPayConfig } from '@solvapay/core'

/**
 * List plans - core implementation
 */
export async function listPlansCore(request: Request): Promise<
  | {
      plans: any[]
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

    const config = getSolvaPayConfig()
    const solvapaySecretKey = config.apiKey
    const solvapayApiBaseUrl = config.apiBaseUrl

    if (!solvapaySecretKey) {
      return {
        error: 'Server configuration error: SolvaPay secret key not configured',
        status: 500,
      }
    }

    const apiClient = createSolvaPayClient({
      apiKey: solvapaySecretKey,
      apiBaseUrl: solvapayApiBaseUrl,
    })

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
