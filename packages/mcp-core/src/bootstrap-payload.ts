/**
 * Standalone `buildBootstrapPayload` factory — same logic
 * `buildSolvaPayDescriptors` wires under the intent tools, exposed
 * separately for adapters that want to produce a fresh intent-tool
 * bootstrap without going through the full descriptor bundle.
 *
 * This used to be invoked from the widget-paywall branch of
 * `buildPayableHandler` / `paywallToolResult` (to embed the full
 * `BootstrapPayload` on the gate response), but those branches are
 * text-only now and no longer need the closure.
 */

import {
  checkLimitsCore,
  checkPurchaseCore,
  classifyPaywallState,
  createCheckoutSessionCore,
  createCustomerSessionCore,
  creditSignals,
  deriveUsageSnapshot,
  getCustomerBalanceCore,
  getMerchantCore,
  getPaymentMethodCore,
  getProductCore,
  isErrorResult,
  listPlansCore,
  nextActionFor,
  type ErrorResult,
  type SolvaPay,
} from '@solvapay/server'
import {
  buildSolvaPayRequest,
  defaultGetCustomerRef as defaultGetCustomerRefHelper,
  enrichPurchase,
} from './helpers'
import { selectActivePlanPurchase } from './active-purchase'
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
) => Promise<BootstrapPayload>

const okOrNull = <T>(result: T | ErrorResult): T | null =>
  isErrorResult(result) ? null : (result as T)

/**
 * Multi-line recovery text shown when `getMerchantCore` returns 404 —
 * i.e. the deployed worker holds a valid `SOLVAPAY_SECRET_KEY` but
 * the SolvaPay backend has no merchant on file for it. This happens
 * when the deploy preflights are bypassed (raw `wrangler deploy`) or
 * when a user manually pushed a stale key. The message names the
 * exact recovery step (`npx solvapay init`) and the redeploy follow-up
 * so the agent / human can self-serve out of it.
 */
const buildProviderNotFoundMessage = (): string =>
  [
    'Provider account not found on this SolvaPay deployment.',
    '',
    'The Worker secret key authenticates against SolvaPay, but no merchant',
    'record exists for it. This usually means the secret key was created',
    'manually (without running `solvapay init`) or the merchant was deleted.',
    '',
    'To recover:',
    '  1. Run `npx solvapay init` in the project root. It will create the',
    '     merchant on the backend and write a valid secret key to `.env`.',
    '  2. Redeploy with `npm run deploy` to push the corrected secret to',
    '     the Worker.',
    '',
    'No tool calls will succeed until the merchant exists.',
  ].join('\n')

/**
 * Throw an Error carrying `{ status, details }` so the `trace` wrapper
 * in `descriptors.ts` can surface the upstream HTTP status verbatim
 * and put the human-readable recovery text on `content[0].text`.
 *
 * A plain `Error` is used (rather than `SolvaPayError`) so the helper
 * stays usable from `@solvapay/mcp-core` without re-exporting the
 * class from `@solvapay/core` through a runtime dep cycle. The trace
 * wrapper duck-types `status` / `details` and doesn't care about
 * `instanceof`.
 */
const createBootstrapMerchantError = (merchantResult: ErrorResult): Error => {
  const details =
    merchantResult.status === 404
      ? buildProviderNotFoundMessage()
      : `bootstrap: merchant lookup failed: ${merchantResult.error}`
  const err = new Error(details)
  Object.assign(err, { status: merchantResult.status, details })
  return err
}

const createBootstrapProductError = (productResult: ErrorResult): Error => {
  const details = `bootstrap: product lookup failed: ${productResult.error}`
  const err = new Error(details)
  Object.assign(err, { status: productResult.status, details })
  return err
}

/**
 * Produce a reusable `buildBootstrapPayload(view, extra)` closure
 * wired against the same SolvaPay instance + product as a
 * `buildSolvaPayDescriptors` bundle.
 *
 * The returned function runs `getMerchant`, `getProduct`, `listPlans`,
 * `checkPurchase`, `getPaymentMethod`, `getCustomerBalance`, `checkLimits`
 * in parallel, failing loudly when merchant or product can't load (the
 * React shell can't render meaningfully without them) and degrading
 * gracefully on per-customer sub-reads. Usage is derived from the
 * purchase + the same limits result so metered plans do not call
 * `checkLimits` twice.
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

  return async (view, extra) => {
    const customerRef = getCustomerRef(extra)

    const wrapError = <T>(promise: Promise<T | ErrorResult>): Promise<T | ErrorResult> =>
      promise.catch<ErrorResult>(err => ({
        error: err instanceof Error ? err.message : String(err),
        status: 500,
      }))

    const unauthenticated = (): Promise<ErrorResult> =>
      Promise.resolve({ error: 'unauthenticated', status: 401 })

    const limitsRequest = () =>
      buildSolvaPayRequest(extra, { query: { productRef }, getCustomerRef })

    const [
      stripePublishableKey,
      merchantResult,
      productResult,
      plansResult,
      purchaseResult,
      paymentMethodResult,
      balanceResult,
      limitsResult,
      portalResult,
    ] = await Promise.all([
      fetchPublishableKey(),
      getMerchantCore(buildRequest(undefined), { solvaPay }),
      getProductCore(productQueryRequest(), { solvaPay }),
      wrapError(listPlansCore(productQueryRequest(), { solvaPay })),
      customerRef ? wrapError(checkPurchaseCore(buildRequest(extra), { solvaPay })) : unauthenticated(),
      customerRef ? wrapError(getPaymentMethodCore(buildRequest(extra), { solvaPay })) : unauthenticated(),
      customerRef ? wrapError(getCustomerBalanceCore(buildRequest(extra), { solvaPay })) : unauthenticated(),
      customerRef ? wrapError(checkLimitsCore(limitsRequest(), { solvaPay })) : unauthenticated(),
      customerRef
        ? wrapError(createCustomerSessionCore(buildRequest(extra), { solvaPay }))
        : unauthenticated(),
    ])

    const limits = okOrNull(limitsResult)
    const checkoutPurpose =
      view === 'topup' || view === 'auto-recharge' || limits?.paywallReason === 'topup_required'
        ? ('credit_topup' as const)
        : undefined
    const checkoutResult = await wrapError(
      createCheckoutSessionCore(
        buildSolvaPayRequest(extra, {
          getCustomerRef: () => customerRef ?? 'anonymous',
        }),
        { productRef, returnUrl: publicBaseUrl, ...(checkoutPurpose ? { purpose: checkoutPurpose } : {}) },
        { solvaPay, returnUrl: publicBaseUrl },
      ),
    )

    if (isErrorResult(merchantResult)) {
      throw createBootstrapMerchantError(merchantResult)
    }
    if (isErrorResult(productResult)) {
      throw createBootstrapProductError(productResult)
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

    const activePurchase = selectActivePlanPurchase(enrichedPurchase?.purchases, productRef)
    const usage = customerRef
      ? deriveUsageSnapshot({
          // Consumption comes from `limits.used` (or `limit - remaining`)
          // inside `deriveUsageSnapshot`. `purchase.usage.used` is only
          // ever reset to zero by the backend and must not be the source.
          used: 0,
          periodStart: activePurchase?.usage?.periodStart,
          periodEnd: activePurchase?.usage?.periodEnd,
          purchaseRef: activePurchase?.reference,
          limits,
        })
      : null

    const signals = limits ? creditSignals(limits) : null
    const state = limits ? classifyPaywallState(limits) : null
    const customer: BootstrapPayload['customer'] = customerRef
      ? {
          ref: customerRef,
          purchase: enrichedPurchase,
          paymentMethod: okOrNull(paymentMethodResult),
          balance: okOrNull(balanceResult),
          usage,
          limits,
          ...(limits ? { canCall: limits.withinLimits === true } : {}),
          ...(signals?.remainingCalls !== undefined
            ? { remainingCalls: signals.remainingCalls }
            : {}),
          ...(signals?.creditsPerCall !== undefined
            ? { creditsPerCall: signals.creditsPerCall }
            : {}),
          ...(signals?.shortfallCredits !== undefined
            ? { shortfallCredits: signals.shortfallCredits }
            : {}),
          ...(limits?.autoRecharge !== undefined ? { autoRecharge: limits.autoRecharge } : {}),
          ...(state ? { nextAction: nextActionFor(state) } : {}),
        }
      : null

    const checkout = okOrNull(checkoutResult)
    const portal = okOrNull(portalResult)

    return {
      view,
      productRef,
      stripePublishableKey,
      returnUrl: publicBaseUrl,
      merchant: merchantResult,
      product: productResult,
      plans,
      customer,
      checkoutUrl: checkout?.checkoutUrl ?? null,
      portalUrl: portal?.customerUrl ?? null,
    }
  }
}
