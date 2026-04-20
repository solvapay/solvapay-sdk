/**
 * Shared Next.js catch-all route dispatcher for SolvaPay examples.
 *
 * Wraps `@solvapay/next` helpers into a single `{ GET, POST }` handler
 * pair keyed by route name, so every example can expose the full
 * SolvaPay API surface from one `app/api/solvapay/[...solvapay]/route.ts`.
 *
 * In a real app, inline whichever routes you use directly into your own
 * handlers — this file is a demo convenience for keeping the examples in
 * lockstep with the default endpoints declared in `SolvaPayProvider.config.api`.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  activatePlan,
  cancelRenewal,
  checkPurchase,
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
import type { SolvaPay } from '@solvapay/server'

type Handler = (request: NextRequest) => Promise<NextResponse>

export type SolvaPayRouteHandlers = {
  GET: (
    request: NextRequest,
    ctx: { params: Promise<{ solvapay: string[] }> },
  ) => Promise<NextResponse>
  POST: (
    request: NextRequest,
    ctx: { params: Promise<{ solvapay: string[] }> },
  ) => Promise<NextResponse>
}

async function bodyJson(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>
  } catch {
    return {}
  }
}

async function resolveRouteKey(
  params: Promise<{ solvapay: string[] }>,
): Promise<string | null> {
  const resolved = await params
  return resolved.solvapay?.[0] ?? null
}

/**
 * Build `{ GET, POST }` handlers backed by the provided `SolvaPay` instance.
 *
 * GET routes: read-only queries (`list-plans`, `merchant`, `get-product`,
 * `customer-balance`, `check-purchase`).
 *
 * POST routes: mutations (`sync-customer`, `create-payment-intent`,
 * `create-topup-payment-intent`, `process-payment`, `activate-plan`,
 * `cancel-renewal`, `reactivate-renewal`).
 */
export function createSolvaPayRouteHandlers(solvaPay: SolvaPay): SolvaPayRouteHandlers {
  const getRoutes: Record<string, Handler> = {
    'list-plans': request => listPlans(request, { solvaPay }),
    'merchant': request => getMerchant(request, { solvaPay }),
    'get-product': request => getProduct(request, { solvaPay }),
    'customer-balance': request => getCustomerBalance(request, { solvaPay }),
    'check-purchase': request => checkPurchase(request, { solvaPay }),
  }

  const postRoutes: Record<string, Handler> = {
    'sync-customer': async request => {
      const result = await syncCustomer(request, { solvaPay })
      if (result instanceof NextResponse) return result
      return NextResponse.json({ customerRef: result, success: true })
    },
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

  async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ solvapay: string[] }> },
  ): Promise<NextResponse> {
    const key = await resolveRouteKey(params)
    const handler = key ? getRoutes[key] : undefined
    if (!handler) {
      return NextResponse.json({ error: `Unknown GET route: ${key}` }, { status: 404 })
    }
    return handler(request)
  }

  async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ solvapay: string[] }> },
  ): Promise<NextResponse> {
    const key = await resolveRouteKey(params)
    const handler = key ? postRoutes[key] : undefined
    if (!handler) {
      return NextResponse.json({ error: `Unknown POST route: ${key}` }, { status: 404 })
    }
    return handler(request)
  }

  return { GET, POST }
}
