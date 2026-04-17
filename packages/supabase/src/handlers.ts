import {
  checkPurchaseCore,
  trackUsageCore,
  createPaymentIntentCore,
  processPaymentIntentCore,
  createTopupPaymentIntentCore,
  getCustomerBalanceCore,
  cancelPurchaseCore,
  reactivatePurchaseCore,
  activatePlanCore,
  listPlansCore,
  syncCustomerCore,
  createCheckoutSessionCore,
  createCustomerSessionCore,
  getMerchantCore,
  getProductCore,
  verifyWebhook,
  isErrorResult,
} from '@solvapay/server'
import type { WebhookEvent } from '@solvapay/server'
import { handleCors } from './cors'
import { errorResponse, jsonResponseWithCors } from './utils'

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

  const result = await checkPurchaseCore(req)

  if (isErrorResult(result)) {
    return errorResponse(result, req)
  }

  return jsonResponseWithCors(result, req)
}

export async function trackUsage(req: Request): Promise<Response> {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

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

  const result = await getCustomerBalanceCore(req)

  if (isErrorResult(result)) {
    return errorResponse(result, req)
  }

  return jsonResponseWithCors(result, req)
}

export async function cancelRenewal(req: Request): Promise<Response> {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

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

  const body = await parseJsonBody(req)
  const result = await activatePlanCore(req, body as never)

  if (isErrorResult(result)) {
    return errorResponse(result, req)
  }

  return jsonResponseWithCors(result, req)
}

export async function listPlans(req: Request): Promise<Response> {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  const result = await listPlansCore(req)

  if (isErrorResult(result)) {
    return errorResponse(result, req)
  }

  return jsonResponseWithCors(result, req)
}

export async function syncCustomer(req: Request): Promise<Response> {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  const result = await syncCustomerCore(req)

  if (isErrorResult(result)) {
    return errorResponse(result, req)
  }

  return jsonResponseWithCors({ customerRef: result }, req)
}

export async function createCheckoutSession(req: Request): Promise<Response> {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

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

  const result = await createCustomerSessionCore(req)

  if (isErrorResult(result)) {
    return errorResponse(result, req)
  }

  return jsonResponseWithCors(result, req)
}

export async function getMerchant(req: Request): Promise<Response> {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  const result = await getMerchantCore(req)

  if (isErrorResult(result)) {
    return errorResponse(result, req)
  }

  return jsonResponseWithCors(result, req)
}

export async function getProduct(req: Request): Promise<Response> {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  const result = await getProductCore(req)

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
    const secret = options.secret || (typeof process !== 'undefined' ? process.env.SOLVAPAY_WEBHOOK_SECRET : undefined)
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
      event = verifyWebhook({ body, signature, secret })
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
