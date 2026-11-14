/**
 * Fetch-first `(req: Request) => Promise<Response>` handlers for every
 * SolvaPay route, plus the `solvapayWebhook` factory. Wraps the pure
 * `*Core` helpers from `../helpers` with CORS + JSON serialisation so
 * the edge-runtime entry point (Deno / Supabase Edge / Cloudflare
 * Workers / Bun / Next edge / Vercel Functions) is a one-liner:
 *
 * ```ts
 * import { checkPurchase } from '@solvapay/server/fetch'
 * Deno.serve(checkPurchase)
 * ```
 *
 * Lifted verbatim from `@solvapay/fetch@1.0.0` when the standalone
 * package was folded into `@solvapay/server` as the `./fetch` subpath
 * export. Three substantive tweaks captured in the move:
 *
 *  1. `*Core` imports are relative (`'../helpers'`), not self-imports
 *     through `'@solvapay/server'` — avoids the re-export indirection
 *     and keeps the build tree-shake-friendly.
 *  2. `verifyWebhook` imports from `'../edge'` explicitly so the
 *     `./fetch` subpath is deterministically Web Crypto regardless of
 *     which export condition a consumer's bundler selects for
 *     `@solvapay/server` (the root entry's `node:crypto` variant was
 *     the wrong choice on edge runtimes and the bundler-selected
 *     default could swing either way).
 *  3. `await verifyWebhook(...)` — the previous call was un-awaited.
 *     Worked by accident on Deno because the `deno` export condition
 *     resolved `@solvapay/server` to `./dist/edge.js` (async Web Crypto
 *     variant), and passing the Promise through `options.onEvent` got
 *     coerced to the event object in most handlers. Latent bug —
 *     surfaced as "event is a Promise" in strict TypeScript handlers
 *     that destructured `event.type` synchronously. The `await` makes
 *     the handler return the parsed `WebhookEvent` deterministically.
 */

import type { WebhookEvent } from '../types/webhook'
import {
  activatePlanCore,
  attachBusinessDetailsCore,
  cancelPurchaseCore,
  checkLimitsCore,
  checkPurchaseCore,
  createCheckoutSessionCore,
  createCustomerSessionCore,
  createPaymentIntentCore,
  createTopupPaymentIntentCore,
  disableAutoRechargeCore,
  getAutoRechargeCore,
  getCustomerBalanceCore,
  getHistoryCore,
  getMerchantCore,
  getPaymentMethodCore,
  getProductCore,
  getUsageCore,
  isErrorResult,
  listPlansCore,
  processPaymentIntentCore,
  processTopupPaymentIntentCore,
  reactivatePurchaseCore,
  saveAutoRechargeCore,
  syncCustomerCore,
  trackUsageCore,
} from '../helpers'
import { SOLVAPAY_USER_ID_HEADER } from '@solvapay/auth'
import { verifyWebhook } from '../edge'
import { handleCors } from './cors'
import { errorResponse, jsonResponseWithCors } from './utils'

/**
 * These handlers run with no middleware in front of them, so a user id header
 * on the request can only have come from the client. Drop it, so identity
 * comes from a verified bearer token alone (see `getAuthenticatedUserCore`).
 */
function withoutClientUserId(req: Request): Request {
  if (!req.headers.has(SOLVAPAY_USER_ID_HEADER)) return req
  const headers = new Headers(req.headers)
  headers.delete(SOLVAPAY_USER_ID_HEADER)
  return new Request(req, { headers })
}

async function parseJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>
  } catch {
    return {}
  }
}

export async function checkPurchase(req: Request): Promise<Response> {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse
  req = withoutClientUserId(req)

  const result = await checkPurchaseCore(req)

  if (isErrorResult(result)) {
    return errorResponse(result, req)
  }

  return jsonResponseWithCors(result, req)
}

export async function trackUsage(req: Request): Promise<Response> {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse
  req = withoutClientUserId(req)

  const body = await parseJsonBody(req)
  const result = await trackUsageCore(req, body as never, {})

  if (isErrorResult(result)) {
    return errorResponse(result, req)
  }

  return jsonResponseWithCors(result, req)
}

export async function createPaymentIntent(req: Request): Promise<Response> {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse
  req = withoutClientUserId(req)

  const body = await parseJsonBody(req)
  const result = await createPaymentIntentCore(req, body as never)

  if (isErrorResult(result)) {
    return errorResponse(result, req)
  }

  return jsonResponseWithCors(result, req)
}

export async function processPayment(req: Request): Promise<Response> {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse
  req = withoutClientUserId(req)

  const body = await parseJsonBody(req)
  const result = await processPaymentIntentCore(req, body as never)

  if (isErrorResult(result)) {
    return errorResponse(result, req)
  }

  return jsonResponseWithCors(result, req)
}

export async function createTopupPaymentIntent(req: Request): Promise<Response> {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse
  req = withoutClientUserId(req)

  const body = await parseJsonBody(req)
  const result = await createTopupPaymentIntentCore(req, body as never)

  if (isErrorResult(result)) {
    return errorResponse(result, req)
  }

  return jsonResponseWithCors(result, req)
}

export async function customerBalance(req: Request): Promise<Response> {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse
  req = withoutClientUserId(req)

  const result = await getCustomerBalanceCore(req)

  if (isErrorResult(result)) {
    return errorResponse(result, req)
  }

  return jsonResponseWithCors(result, req)
}

export async function cancelRenewal(req: Request): Promise<Response> {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse
  req = withoutClientUserId(req)

  const body = await parseJsonBody(req)
  const result = await cancelPurchaseCore(req, body as never)

  if (isErrorResult(result)) {
    return errorResponse(result, req)
  }

  return jsonResponseWithCors(result, req)
}

export async function reactivateRenewal(req: Request): Promise<Response> {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse
  req = withoutClientUserId(req)

  const body = await parseJsonBody(req)
  const result = await reactivatePurchaseCore(req, body as never)

  if (isErrorResult(result)) {
    return errorResponse(result, req)
  }

  return jsonResponseWithCors(result, req)
}

export async function activatePlan(req: Request): Promise<Response> {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse
  req = withoutClientUserId(req)

  const body = await parseJsonBody(req)
  const result = await activatePlanCore(req, body as never)

  if (isErrorResult(result)) {
    return errorResponse(result, req)
  }

  return jsonResponseWithCors(result, req)
}

export async function getPaymentMethod(req: Request): Promise<Response> {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse
  req = withoutClientUserId(req)

  const result = await getPaymentMethodCore(req)

  if (isErrorResult(result)) {
    return errorResponse(result, req)
  }

  return jsonResponseWithCors(result, req)
}

export async function listPlans(req: Request): Promise<Response> {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse
  req = withoutClientUserId(req)

  const result = await listPlansCore(req)

  if (isErrorResult(result)) {
    return errorResponse(result, req)
  }

  return jsonResponseWithCors(result, req)
}

export async function syncCustomer(req: Request): Promise<Response> {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse
  req = withoutClientUserId(req)

  const result = await syncCustomerCore(req)

  if (isErrorResult(result)) {
    return errorResponse(result, req)
  }

  return jsonResponseWithCors({ customerRef: result }, req)
}

export async function createCheckoutSession(req: Request): Promise<Response> {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse
  req = withoutClientUserId(req)

  const body = await parseJsonBody(req)
  const result = await createCheckoutSessionCore(req, body as never)

  if (isErrorResult(result)) {
    return errorResponse(result, req)
  }

  return jsonResponseWithCors(result, req)
}

export async function createCustomerSession(req: Request): Promise<Response> {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse
  req = withoutClientUserId(req)

  const result = await createCustomerSessionCore(req)

  if (isErrorResult(result)) {
    return errorResponse(result, req)
  }

  return jsonResponseWithCors(result, req)
}

export async function getMerchant(req: Request): Promise<Response> {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse
  req = withoutClientUserId(req)

  const result = await getMerchantCore(req)

  if (isErrorResult(result)) {
    return errorResponse(result, req)
  }

  return jsonResponseWithCors(result, req)
}

export async function getProduct(req: Request): Promise<Response> {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse
  req = withoutClientUserId(req)

  const result = await getProductCore(req)

  if (isErrorResult(result)) {
    return errorResponse(result, req)
  }

  return jsonResponseWithCors(result, req)
}

export async function getHistory(req: Request): Promise<Response> {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse
  req = withoutClientUserId(req)

  const url = new URL(req.url)
  const productRef = url.searchParams.get('productRef') ?? ''
  const limitRaw = url.searchParams.get('limit')
  const limit = limitRaw ? Number(limitRaw) : undefined
  if (limitRaw && (!Number.isInteger(limit) || Number(limit) < 1)) {
    return errorResponse({ error: 'limit must be a positive integer', status: 400 }, req)
  }

  const result = await getHistoryCore(req, {
    productRef,
    ...(limit !== undefined ? { limit } : {}),
  })

  if (isErrorResult(result)) {
    return errorResponse(result, req)
  }

  return jsonResponseWithCors(result, req)
}

export async function processTopupPayment(req: Request): Promise<Response> {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse
  req = withoutClientUserId(req)

  const body = await parseJsonBody(req)
  const result = await processTopupPaymentIntentCore(req, body as never)

  if (isErrorResult(result)) {
    return errorResponse(result, req)
  }

  return jsonResponseWithCors(result, req)
}

export async function attachBusinessDetails(req: Request): Promise<Response> {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse
  req = withoutClientUserId(req)

  const body = await parseJsonBody(req)
  const result = await attachBusinessDetailsCore(req, body as never)

  if (isErrorResult(result)) {
    return errorResponse(result, req)
  }

  return jsonResponseWithCors(result, req)
}

export async function getAutoRecharge(req: Request): Promise<Response> {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse
  req = withoutClientUserId(req)

  const result = await getAutoRechargeCore(req)

  if (isErrorResult(result)) {
    return errorResponse(result, req)
  }

  return jsonResponseWithCors(result, req)
}

export async function saveAutoRecharge(req: Request): Promise<Response> {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse
  req = withoutClientUserId(req)

  const body = await parseJsonBody(req)
  const result = await saveAutoRechargeCore(req, body as never)

  if (isErrorResult(result)) {
    return errorResponse(result, req)
  }

  return jsonResponseWithCors(result, req)
}

export async function disableAutoRecharge(req: Request): Promise<Response> {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse
  req = withoutClientUserId(req)

  const result = await disableAutoRechargeCore(req)

  if (isErrorResult(result)) {
    return errorResponse(result, req)
  }

  return jsonResponseWithCors(result, req)
}

export async function getUsage(req: Request): Promise<Response> {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse
  req = withoutClientUserId(req)

  const result = await getUsageCore(req)

  if (isErrorResult(result)) {
    return errorResponse(result, req)
  }

  return jsonResponseWithCors(result, req)
}

export async function checkLimits(req: Request): Promise<Response> {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse
  req = withoutClientUserId(req)

  const result = await checkLimitsCore(req)

  if (isErrorResult(result)) {
    return errorResponse(result, req)
  }

  return jsonResponseWithCors(result, req)
}

export interface SolvapayWebhookOptions {
  secret?: string
  onEvent: (event: WebhookEvent) => void | Promise<void>
}

export function solvapayWebhook(options: SolvapayWebhookOptions): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const secret =
      options.secret ||
      (typeof process !== 'undefined' ? process.env.SOLVAPAY_WEBHOOK_SECRET : undefined)
    if (!secret) {
      return new Response(JSON.stringify({ error: 'Webhook secret not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const body = await req.text()
    const signature = req.headers.get('sv-signature') ?? ''

    let event: WebhookEvent
    try {
      // `verifyWebhook` is the async Web Crypto variant from `../edge`
      // (deterministic choice — see module-level comment for why the
      // root entry's `node:crypto` variant would be wrong here even on
      // Node's undici-backed fetch runtime).
      event = await verifyWebhook({ body, signature, secret })
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid webhook signature' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    try {
      await options.onEvent(event)
    } catch {
      return new Response(JSON.stringify({ error: 'Webhook handler failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
