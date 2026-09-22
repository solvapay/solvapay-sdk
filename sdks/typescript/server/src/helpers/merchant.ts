/**
 * Merchant Helper (Core)
 *
 * Generic helper for GET /api/merchant — returns the SDK-facing merchant
 * identity used by `<MandateText>`, `<CheckoutSummary>`, and trust signals.
 * Works with standard Web API Request (Express, Fastify, Next.js, Edge).
 */

import type { ErrorResult } from './types'
import type { SdkMerchantResponse } from '../types/client'
import type { SolvaPay } from '../factory'
import { createSolvaPayClient } from '../client'
import { handleRouteError } from './error'
import { mapRouteError } from '../native-decisions'
import { getSolvaPayConfig } from '@solvapay/core'

export async function getMerchantCore(
  _request: Request,
  options: {
    solvaPay?: SolvaPay
  } = {},
): Promise<SdkMerchantResponse | ErrorResult> {
  try {
    const apiClient =
      options.solvaPay?.apiClient ??
      (() => {
        const config = getSolvaPayConfig()
        if (!config.apiKey) return null
        return createSolvaPayClient({
          apiKey: config.apiKey,
          apiBaseUrl: config.apiBaseUrl,
        })
      })()

    if (!apiClient) {
      return mapRouteError({
        kind: 'solvapay',
        message: 'Server configuration error: SolvaPay secret key not configured',
        operationName: 'Get merchant',
      })
    }

    if (!apiClient.getMerchant) {
      return mapRouteError({
        kind: 'solvapay',
        message: 'Get merchant method not available',
        operationName: 'Get merchant',
      })
    }

    const merchant = await apiClient.getMerchant()
    return merchant
  } catch (error) {
    return handleRouteError(error, 'Get merchant', 'Failed to fetch merchant')
  }
}
