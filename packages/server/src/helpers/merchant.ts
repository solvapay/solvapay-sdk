/**
 * Merchant Helper (Core)
 *
 * Generic helper for GET /api/merchant — returns the SDK-facing merchant
 * identity used by `<MandateText>`, `<CheckoutSummary>`, and trust signals.
 * Works with standard Web API Request (Express, Fastify, Next.js, Edge).
 */

import type { ErrorResult } from './types'
import type { SdkMerchantResponse } from '../types/client'
import { createSolvaPayClient } from '../client'
import { handleRouteError } from './error'
import { getSolvaPayConfig } from '@solvapay/core'

export async function getMerchantCore(
  _request: Request,
): Promise<SdkMerchantResponse | ErrorResult> {
  try {
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

    if (!apiClient.getMerchant) {
      return {
        error: 'Get merchant method not available',
        status: 500,
      }
    }

    const merchant = await apiClient.getMerchant()
    return merchant
  } catch (error) {
    return handleRouteError(error, 'Get merchant', 'Failed to fetch merchant')
  }
}
