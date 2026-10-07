/**
 * Next.js Payment Helpers
 */

import type { NextResponse } from 'next/server'
import type { SolvaPay } from '@solvapay/server'
import type { TaxIdType } from '@solvapay/core'
import {
  createPaymentIntentCore,
  createTopupPaymentIntentCore,
  processPaymentIntentCore,
  processTopupPaymentIntentCore,
  attachBusinessDetailsCore,
  createCaptureGrantCore,
  confirmPaymentCore,
  createCardSetupGrantCore,
  saveCardCore,
  isErrorResult,
} from '@solvapay/server'
import type { SaveCardBody } from '@solvapay/server'
import { toNextRouteResponse } from './_response'
import { invalidatePurchaseCacheForRequest } from './_cache'

/**
 * Next.js route wrapper for POST /api/create-payment-intent.
 *
 * @example
 * ```ts
 * // app/api/create-payment-intent/route.ts
 * import { createPaymentIntent } from '@solvapay/next/helpers'
 *
 * export async function POST(request: Request) {
 *   const { planRef, productRef } = await request.json()
 *   return createPaymentIntent(request, { planRef, productRef })
 * }
 * ```
 */
export async function createPaymentIntent(
  request: globalThis.Request,
  body: {
    planRef: string
    productRef: string
  },
  options: {
    solvaPay?: SolvaPay
    includeEmail?: boolean
    includeName?: boolean
  } = {},
): Promise<NextResponse> {
  const result = await createPaymentIntentCore(request, body, options)
  if (!isErrorResult(result)) {
    await invalidatePurchaseCacheForRequest(request)
  }
  return toNextRouteResponse(result)
}

/**
 * Next.js route wrapper for POST /api/create-topup-payment-intent.
 *
 * @example
 * ```ts
 * // app/api/create-topup-payment-intent/route.ts
 * import { createTopupPaymentIntent } from '@solvapay/next/helpers'
 *
 * export async function POST(request: Request) {
 *   const { amount, currency, description } = await request.json()
 *   return createTopupPaymentIntent(request, { amount, currency, description })
 * }
 * ```
 */
export async function createTopupPaymentIntent(
  request: globalThis.Request,
  body: {
    amount: number
    currency: string
    description?: string
    autoRecharge?: import('@solvapay/server').AutoRechargeInput
  },
  options: {
    solvaPay?: SolvaPay
    includeEmail?: boolean
    includeName?: boolean
  } = {},
): Promise<NextResponse> {
  const result = await createTopupPaymentIntentCore(request, body, options)
  if (!isErrorResult(result)) {
    await invalidatePurchaseCacheForRequest(request)
  }
  return toNextRouteResponse(result)
}

/**
 * Next.js route wrapper for POST /api/process-payment.
 *
 * @example
 * ```ts
 * // app/api/process-payment/route.ts
 * import { processPaymentIntent } from '@solvapay/next/helpers'
 *
 * export async function POST(request: Request) {
 *   const { paymentIntentId, productRef, planRef } = await request.json()
 *   return processPaymentIntent(request, { paymentIntentId, productRef, planRef })
 * }
 * ```
 */
export async function processPaymentIntent(
  request: globalThis.Request,
  body: {
    paymentIntentId: string
    productRef: string
    planRef?: string
  },
  options: {
    solvaPay?: SolvaPay
  } = {},
): Promise<NextResponse> {
  const result = await processPaymentIntentCore(request, body, options)
  if (!isErrorResult(result)) {
    await invalidatePurchaseCacheForRequest(request)
  }
  return toNextRouteResponse(result)
}

/**
 * Next.js route wrapper for POST /api/process-topup-payment.
 *
 * @example
 * ```ts
 * // app/api/process-topup-payment/route.ts
 * import { processTopupPaymentIntent } from '@solvapay/next/helpers'
 *
 * export async function POST(request: Request) {
 *   const { paymentIntentId } = await request.json()
 *   return processTopupPaymentIntent(request, { paymentIntentId })
 * }
 * ```
 */
export async function processTopupPaymentIntent(
  request: globalThis.Request,
  body: {
    paymentIntentId: string
  },
  options: {
    solvaPay?: SolvaPay
  } = {},
): Promise<NextResponse> {
  const result = await processTopupPaymentIntentCore(request, body, options)
  if (!isErrorResult(result)) {
    await invalidatePurchaseCacheForRequest(request)
  }
  return toNextRouteResponse(result)
}

/**
 * Next.js route wrapper for POST /api/attach-business-details.
 */
export async function attachBusinessDetails(
  request: globalThis.Request,
  body: {
    paymentIntentId: string
    isBusiness: boolean
    businessName?: string
    country?: string
    taxId?: string
    taxIdType?: TaxIdType
  },
  options: {
    solvaPay?: SolvaPay
  } = {},
): Promise<NextResponse> {
  const result = await attachBusinessDetailsCore(request, body, options)
  return toNextRouteResponse(result)
}

/**
 * Next.js route wrapper for POST /api/create-capture-grant.
 *
 * @example
 * ```typescript
 * export async function POST(request: Request) {
 *   const { paymentIntentId } = await request.json()
 *   return createCaptureGrant(request, { paymentIntentId })
 * }
 * ```
 */
export async function createCaptureGrant(
  request: globalThis.Request,
  body: { paymentIntentId: string },
  options: { solvaPay?: SolvaPay } = {},
): Promise<NextResponse> {
  const result = await createCaptureGrantCore(request, body, options)
  return toNextRouteResponse(result)
}

/**
 * Next.js route wrapper for POST /api/confirm-payment.
 *
 * @example
 * ```typescript
 * export async function POST(request: Request) {
 *   const { paymentIntentId, cardId, paymentMethodId, returnUrl } = await request.json()
 *   return confirmPayment(request, { paymentIntentId, cardId, paymentMethodId, returnUrl })
 * }
 * ```
 */
export async function confirmPayment(
  request: globalThis.Request,
  body: {
    paymentIntentId: string
    cardId?: string
    paymentMethodId?: string
    returnUrl?: string
  },
  options: { solvaPay?: SolvaPay } = {},
): Promise<NextResponse> {
  const result = await confirmPaymentCore(request, body, options)
  return toNextRouteResponse(result)
}

/**
 * Next.js route wrapper for POST /api/create-card-setup-grant: a vault grant
 * on a fresh customer session, for saving a card without paying
 * (`AutoRecharge.CardSetup`).
 *
 * @example
 * ```typescript
 * export async function POST(request: Request) {
 *   return createCardSetupGrant(request)
 * }
 * ```
 */
export async function createCardSetupGrant(
  request: globalThis.Request,
  options: { solvaPay?: SolvaPay } = {},
): Promise<NextResponse> {
  const result = await createCardSetupGrantCore(request, options)
  return toNextRouteResponse(result)
}

/**
 * Next.js route wrapper for POST /api/save-card: save the captured card on
 * the grant's customer session (`{ sessionId, cardId, returnUrl,
 * billingDetails? }`), or complete the setup the payer just authenticated
 * (`{ sessionId, completePendingSetup: true }`). Pass the parsed request
 * body through; the body is validated here.
 *
 * @example
 * ```typescript
 * export async function POST(request: Request) {
 *   return saveCard(request, await request.json())
 * }
 * ```
 */
export async function saveCard(
  request: globalThis.Request,
  body: SaveCardBody | Record<string, unknown>,
  options: { solvaPay?: SolvaPay } = {},
): Promise<NextResponse> {
  const result = await saveCardCore(request, body, options)
  return toNextRouteResponse(result)
}
