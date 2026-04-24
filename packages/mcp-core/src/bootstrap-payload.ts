/**
 * Standalone `buildBootstrapPayload` factory — same logic `buildSolvaPayDescriptors`
 * wires under the `open_*` tools, exposed separately so the paywall
 * envelope (`paywallToolResult`, `buildPayableHandler`) can embed the
 * full `BootstrapPayload` in `structuredContent` without duplicating
 * the parallel fetch layout.
 */

import {
  checkPurchaseCore,
  getCustomerBalanceCore,
  getMerchantCore,
  getPaymentMethodCore,
  getProductCore,
  getUsageCore,
  isErrorResult,
  listPlansCore,
  type ErrorResult,
  type PaywallStructuredContent,
  type SolvaPay,
} from '@solvapay/server'
import {
  buildSolvaPayRequest,
  defaultGetCustomerRef as defaultGetCustomerRefHelper,
  enrichPurchase,
} from './helpers'
import type {
  BootstrapPayload,
  McpToolExtra,
  SolvaPayMcpViewKind,
} from './types'

export interface CreateBuildBootstrapPayloadOptions {
  solvaPay: SolvaPay
  productRef: string
  publicBaseUrl: string
  getCustomerRef?: (extra?: McpToolExtra) => string | null
}

export type BuildBootstrapPayloadFn = (
  view: SolvaPayMcpViewKind,
  extra: McpToolExtra | undefined,
  extras?: { paywall?: PaywallStructuredContent },
) => Promise<BootstrapPayload>

const okOrNull = <T>(result: T | ErrorResult): T | null =>
  isErrorResult(result) ? null : (result as T)

/**
 * Produce a reusable `buildBootstrapPayload(view, extra, extras?)` closure
 * wired against the same SolvaPay instance + product as a
 * `buildSolvaPayDescriptors` bundle.
 *
 * The returned function runs `getMerchant`, `getProduct`, `listPlans`,
 * `checkPurchase`, `getPaymentMethod`, `getCustomerBalance`, `getUsage`
 * in parallel, failing loudly when merchant or product can't load (the
 * React shell can't render meaningfully without them) and degrading
 * gracefully on per-customer sub-reads.
 */
export function createBuildBootstrapPayload(
  options: CreateBuildBootstrapPayloadOptions,
): BuildBootstrapPayloadFn {
  const {
    solvaPay,
    productRef,
    publicBaseUrl,
    getCustomerRef = defaultGetCustomerRefHelper,
  } = options

  const fetchPublishableKey = async (): Promise<string | null> => {
    try {
      const platform = await solvaPay.apiClient.getPlatformConfig?.()
      return platform?.stripePublishableKey ?? null
    } catch {
      return null
    }
  }

  const buildRequest = (extra: McpToolExtra | undefined) =>
    buildSolvaPayRequest(extra, { getCustomerRef })

  const productQueryRequest = () =>
    buildSolvaPayRequest(undefined, { query: { productRef }, getCustomerRef: () => null })

  return async (view, extra, extras = {}) => {
    const customerRef = getCustomerRef(extra)

    const wrapError = <T>(promise: Promise<T | ErrorResult>): Promise<T | ErrorResult> =>
      promise.catch<ErrorResult>(err => ({
        error: err instanceof Error ? err.message : String(err),
        status: 500,
      }))

    const unauthenticated = (): Promise<ErrorResult> =>
      Promise.resolve({ error: 'unauthenticated', status: 401 })

    const [
      stripePublishableKey,
      merchantResult,
      productResult,
      plansResult,
      purchaseResult,
      paymentMethodResult,
      balanceResult,
      usageResult,
    ] = await Promise.all([
      fetchPublishableKey(),
      getMerchantCore(buildRequest(undefined), { solvaPay }),
      getProductCore(productQueryRequest(), { solvaPay }),
      wrapError(listPlansCore(productQueryRequest(), { solvaPay })),
      customerRef ? wrapError(checkPurchaseCore(buildRequest(extra), { solvaPay })) : unauthenticated(),
      customerRef ? wrapError(getPaymentMethodCore(buildRequest(extra), { solvaPay })) : unauthenticated(),
      customerRef ? wrapError(getCustomerBalanceCore(buildRequest(extra), { solvaPay })) : unauthenticated(),
      customerRef ? wrapError(getUsageCore(buildRequest(extra), { solvaPay })) : unauthenticated(),
    ])

    if (isErrorResult(merchantResult)) {
      throw new Error(`bootstrap: merchant lookup failed: ${merchantResult.error}`)
    }
    if (isErrorResult(productResult)) {
      throw new Error(`bootstrap: product lookup failed: ${productResult.error}`)
    }

    const plans = isErrorResult(plansResult) ? [] : plansResult.plans

    const purchase = okOrNull(purchaseResult)
    const enrichedPurchase = purchase
      ? {
          ...purchase,
          purchases: purchase.purchases.map(p =>
            enrichPurchase(p as Record<string, unknown>),
          ) as typeof purchase.purchases,
        }
      : null

    const customer: BootstrapPayload['customer'] = customerRef
      ? {
          ref: customerRef,
          purchase: enrichedPurchase,
          paymentMethod: okOrNull(paymentMethodResult),
          balance: okOrNull(balanceResult),
          usage: okOrNull(usageResult),
        }
      : null

    const payload: BootstrapPayload = {
      view,
      productRef,
      stripePublishableKey,
      returnUrl: publicBaseUrl,
      merchant: merchantResult,
      product: productResult,
      plans,
      customer,
    }
    if (extras.paywall) payload.paywall = extras.paywall
    return payload
  }
}
