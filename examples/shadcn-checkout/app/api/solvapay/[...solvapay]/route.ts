/**
 * Canonical registry file (3/4).
 *
 * Catch-all dispatcher for every SolvaPay backend call. Reads the shared
 * SolvaPay instance from `lib/solvapay.ts` and forwards each route to the
 * matching `@solvapay/next` helper.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  activatePlan,
  cancelRenewal,
  createPaymentIntent,
  createTopupPaymentIntent,
  getCustomerBalance,
  getMerchant,
  getProduct,
  listPlans,
  processPaymentIntent,
  reactivateRenewal,
  syncCustomer,
} from '@solvapay/next'
import { getSolvaPay } from '@/lib/solvapay'

const solvaPay = getSolvaPay()

type Handler = (request: NextRequest) => Promise<unknown>

async function bodyJson(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>
  } catch {
    return {}
  }
}

const getRoutes: Record<string, Handler> = {
  'list-plans': request => listPlans(request, { solvaPay }),
  'merchant': request => getMerchant(request, { solvaPay }),
  'get-product': request => getProduct(request, { solvaPay }),
  'customer-balance': request => getCustomerBalance(request, { solvaPay }),
  'sync-customer': request => syncCustomer(request, { solvaPay }),
}

const postRoutes: Record<string, Handler> = {
  'create-payment-intent': async request => {
    const body = await bodyJson(request)
    return createPaymentIntent(
      request,
      { planRef: String(body.planRef), productRef: String(body.productRef) },
      { solvaPay },
    )
  },
  'create-topup-payment-intent': async request => {
    const body = await bodyJson(request)
    return createTopupPaymentIntent(
      request,
      {
        amount: Number(body.amount),
        currency: String(body.currency),
        description: body.description ? String(body.description) : undefined,
      },
      { solvaPay },
    )
  },
  'process-payment': async request => {
    const body = await bodyJson(request)
    return processPaymentIntent(
      request,
      {
        paymentIntentId: String(body.paymentIntentId),
        productRef: String(body.productRef),
        planRef: body.planRef ? String(body.planRef) : undefined,
      },
      { solvaPay },
    )
  },
  'activate-plan': async request => {
    const body = await bodyJson(request)
    return activatePlan(
      request,
      { productRef: String(body.productRef), planRef: String(body.planRef) },
      { solvaPay },
    )
  },
  'cancel-renewal': async request => {
    const body = await bodyJson(request)
    return cancelRenewal(
      request,
      {
        purchaseRef: String(body.purchaseRef),
        reason: body.reason ? String(body.reason) : undefined,
      },
      { solvaPay },
    )
  },
  'reactivate-renewal': async request => {
    const body = await bodyJson(request)
    return reactivateRenewal(
      request,
      { purchaseRef: String(body.purchaseRef) },
      { solvaPay },
    )
  },
}

function toResponse(result: unknown): NextResponse {
  return result instanceof NextResponse ? result : NextResponse.json(result)
}

async function resolveRouteKey(
  params: Promise<{ solvapay: string[] }>,
): Promise<string | null> {
  const resolved = await params
  return resolved.solvapay?.[0] ?? null
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ solvapay: string[] }> },
): Promise<NextResponse> {
  const key = await resolveRouteKey(params)
  const handler = key ? getRoutes[key] : undefined
  if (!handler) {
    return NextResponse.json({ error: `Unknown GET route: ${key}` }, { status: 404 })
  }
  return toResponse(await handler(request))
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ solvapay: string[] }> },
): Promise<NextResponse> {
  const key = await resolveRouteKey(params)
  const handler = key ? postRoutes[key] : undefined
  if (!handler) {
    return NextResponse.json({ error: `Unknown POST route: ${key}` }, { status: 404 })
  }
  return toResponse(await handler(request))
}
