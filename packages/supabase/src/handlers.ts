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
  isErrorResult,
} from '@solvapay/server'
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
