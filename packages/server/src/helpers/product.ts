/**
 * Product Helper (Core)
 *
 * Generic helper for GET /api/get-product?productRef=...
 * Returns a single product by reference, used by the `useProduct` React hook.
 */

import type { ErrorResult } from './types'
import type { SdkProductResponse } from '../types/client'
import type { SolvaPay } from '../factory'
import { createSolvaPayClient } from '../client'
import { handleRouteError } from './error'
import { getSolvaPayConfig } from '@solvapay/core'

export async function getProductCore(
  request: Request,
  options: {
    solvaPay?: SolvaPay
  } = {},
): Promise<SdkProductResponse | ErrorResult> {
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

    if (!apiClient.getProduct) {
      return {
        error: 'Get product method not available',
        status: 500,
      }
    }

    const product = await apiClient.getProduct(productRef)
    return product
  } catch (error) {
    return handleRouteError(error, 'Get product', 'Failed to fetch product')
  }
}
