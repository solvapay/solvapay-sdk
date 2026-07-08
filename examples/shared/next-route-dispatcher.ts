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
  disableAutoRecharge,
  getAutoRecharge,
  getCustomerBalance,
  getMerchant,
  getPaymentMethod,
  getProduct,
  listPlans,
  processPaymentIntent,
  processTopupPaymentIntent,
  reactivateRenewal,
  saveAutoRecharge,
  syncCustomer,
  attachBusinessDetails,
} from '@solvapay/next'
import type { SolvaPay } from '@solvapay/server'

type Handler = (request: Request) => Promise<Response>

export type SolvaPayRouteHandlers = {
  GET: (
    request: Request,
    ctx: { params: Promise<{ solvapay: string[] }> },
  ) => Promise<Response>
  POST: (
    request: Request,
    ctx: { params: Promise<{ solvapay: string[] }> },
  ) => Promise<Response>
  PUT: (
    request: NextRequest,
    ctx: { params: Promise<{ solvapay: string[] }> },
  ) => Promise<Response>
  DELETE: (
    request: NextRequest,
    ctx: { params: Promise<{ solvapay: string[] }> },
  ) => Promise<Response>
}

async function bodyJson(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>
  } catch {
    return {}
  }
}

async function resolveRouteKey(params: Promise<{ solvapay: string[] }>): Promise<string | null> {
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
    merchant: request => getMerchant(request, { solvaPay }),
    'get-product': request => getProduct(request, { solvaPay }),
    'customer-balance': request => getCustomerBalance(request, { solvaPay }),
    'check-purchase': request => checkPurchase(request, { solvaPay }),
    'payment-method': request => getPaymentMethod(request, { solvaPay }),
    'auto-recharge': request => getAutoRecharge(request, { solvaPay }),
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
    'process-topup-payment': async request => {
      const body = await bodyJson(request)
      return processTopupPaymentIntent(
        request,
        { paymentIntentId: String(body.paymentIntentId) },
        { solvaPay },
      )
    },
    'attach-business-details': async request => {
      const body = await bodyJson(request)
      const taxIdTypeRaw = body.taxIdType
      const taxIdType =
        taxIdTypeRaw === 'eu_vat' || taxIdTypeRaw === 'gb_vat' || taxIdTypeRaw === 'us_ein'
          ? taxIdTypeRaw
          : undefined
      return attachBusinessDetails(
        request,
        {
          paymentIntentId: String(body.paymentIntentId),
          isBusiness: Boolean(body.isBusiness),
          ...(body.businessName ? { businessName: String(body.businessName) } : {}),
          ...(body.country ? { country: String(body.country) } : {}),
          ...(body.taxId ? { taxId: String(body.taxId) } : {}),
          ...(taxIdType ? { taxIdType } : {}),
          ...(body.customerRef ? { customerRef: String(body.customerRef) } : {}),
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
      return reactivateRenewal(request, { purchaseRef: String(body.purchaseRef) }, { solvaPay })
    },
  }

  const putRoutes: Record<string, Handler> = {
    'auto-recharge': request => saveAutoRecharge(request, { solvaPay }),
  }

  const deleteRoutes: Record<string, Handler> = {
    'auto-recharge': request => disableAutoRecharge(request, { solvaPay }),
  }

  async function GET(
    request: Request,
    { params }: { params: Promise<{ solvapay: string[] }> },
  ): Promise<Response> {
    const key = await resolveRouteKey(params)
    const handler = key ? getRoutes[key] : undefined
    if (!handler) {
      return NextResponse.json({ error: `Unknown GET route: ${key}` }, { status: 404 })
    }
    return handler(request)
  }

  async function POST(
    request: Request,
    { params }: { params: Promise<{ solvapay: string[] }> },
  ): Promise<Response> {
    const key = await resolveRouteKey(params)
    const handler = key ? postRoutes[key] : undefined
    if (!handler) {
      return NextResponse.json({ error: `Unknown POST route: ${key}` }, { status: 404 })
    }
    return handler(request)
  }

  async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ solvapay: string[] }> },
  ): Promise<Response> {
    const key = await resolveRouteKey(params)
    const handler = key ? putRoutes[key] : undefined
    if (!handler) {
      return NextResponse.json({ error: `Unknown PUT route: ${key}` }, { status: 404 })
    }
    return handler(request)
  }

  async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ solvapay: string[] }> },
  ): Promise<Response> {
    const key = await resolveRouteKey(params)
    const handler = key ? deleteRoutes[key] : undefined
    if (!handler) {
      return NextResponse.json({ error: `Unknown DELETE route: ${key}` }, { status: 404 })
    }
    return handler(request)
  }

  return { GET, POST, PUT, DELETE }
}
