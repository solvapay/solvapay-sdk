/**
 * Opt-in product configuration check against `GET /v1/sdk/products/{ref}`.
 *
 * Never auto-invoked — Node integrators may `await` it once at startup;
 * fetch/edge examples deliberately skip it (no lifecycle hook / no I/O
 * at module scope on Workers).
 */

import { evaluateProductReadiness, SolvaPayError } from '@solvapay/core'
import type { SolvaPayClient } from './types/client'

export type VerifyProductConfigurationOptions = {
  /** API client (typically `solvaPay.apiClient`). Must expose `getProduct`. */
  apiClient: Pick<SolvaPayClient, 'getProduct'>
  productRef: string
  /** Used only in error messages. */
  apiBaseUrl?: string
}

export type ProductConfigurationStatus = {
  name: string
  status: string
  activePlans: number
  totalPlans: number
  /** Usable end-to-end: active product with at least one plan to sell. */
  ready: boolean
  /** Human-readable reasons `ready` is false. Empty when ready. */
  issues: string[]
}

/**
 * Resolve `productRef` against the API. A missing product throws — OAuth
 * DCR would otherwise fail later with an opaque 400 "Invalid identifier".
 * A product that resolves but is not ready to sell returns `{ ready: false }`
 * rather than throwing (OAuth and free tools still work).
 */
export async function verifyProductConfiguration(
  options: VerifyProductConfigurationOptions,
): Promise<ProductConfigurationStatus> {
  const { apiClient, productRef } = options
  const apiBaseUrl = options.apiBaseUrl ?? '(unknown API base URL)'

  if (!apiClient.getProduct) {
    throw new Error(
      'API client cannot look up products (`getProduct` missing), so ' +
        `productRef "${productRef}" cannot be verified. Rebuild @solvapay/server ` +
        'or pass a client that implements getProduct.',
    )
  }

  try {
    const product = await apiClient.getProduct(productRef)
    const readiness = evaluateProductReadiness({
      status: product.status,
      plans: product.plans,
    })

    return {
      name: product.name,
      status: product.status,
      activePlans: readiness.activePlans,
      totalPlans: readiness.totalPlans,
      ready: readiness.ready,
      issues: readiness.issues,
    }
  } catch (error) {
    const status = error instanceof SolvaPayError ? error.status : undefined

    if (status === 404) {
      throw new Error(
        `SOLVAPAY_PRODUCT_REF "${productRef}" does not exist on ${apiBaseUrl}. ` +
          'OAuth dynamic client registration resolves the provider from this ref, so every ' +
          'connection attempt would fail with a 400 "Invalid identifier" and no MCP host ' +
          'could connect. Point SOLVAPAY_PRODUCT_REF at a product that exists on this account ' +
          '(SolvaPay Console → Products, or `npx solvapay init` / `npx solvapay doctor`), and ' +
          'check SOLVAPAY_API_BASE_URL is the environment you created the product in.',
      )
    }

    if (status === 401 || status === 403) {
      throw new Error(
        `${apiBaseUrl} rejected SOLVAPAY_SECRET_KEY while verifying ` +
          `SOLVAPAY_PRODUCT_REF "${productRef}" (HTTP ${status}). The key is missing, revoked, ` +
          'or belongs to a different environment than the API base URL.',
      )
    }

    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Could not verify SOLVAPAY_PRODUCT_REF "${productRef}" against ${apiBaseUrl}: ${detail}. ` +
        'Check SOLVAPAY_API_BASE_URL and that the API is reachable.',
    )
  }
}
