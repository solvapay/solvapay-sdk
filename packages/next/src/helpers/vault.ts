import type { NextResponse } from 'next/server'
import type { SolvaPay } from '@solvapay/server'
import { createCaptureSessionCore, createInstrumentCore } from '@solvapay/server'
import { toNextRouteResponse } from './_response'

/**
 * Next.js Vault Capture Helpers
 *
 * The two routes the card capture surface calls. Neither sees card data: the
 * browser posts the card straight to the vault, and only an identifier comes
 * back through here.
 */

/**
 * Next.js route wrapper for POST /api/capture-session.
 *
 * Mints the short-lived, write-only grant the card fields need. The customer is
 * taken from the request's own session, never from the body, so a caller cannot
 * request a grant on somebody else's behalf.
 *
 * @example
 * ```ts
 * // app/api/capture-session/route.ts
 * import { createCaptureSession } from '@solvapay/next/helpers'
 *
 * export const POST = (request: Request) => createCaptureSession(request)
 * ```
 */
export async function createCaptureSession(
  request: globalThis.Request,
  body: {
    productRef?: string
    planRef?: string
    checkoutSessionId?: string
  } = {},
  options: {
    solvaPay?: SolvaPay
    includeEmail?: boolean
    includeName?: boolean
  } = {},
): Promise<NextResponse> {
  const result = await createCaptureSessionCore(request, body, options)
  return toNextRouteResponse(result)
}

/**
 * Next.js route wrapper for POST /api/instruments.
 *
 * Records the card the vault has already stored. A card already on file comes
 * back with `existing: true` and the reference it already had, which is the
 * normal path for a returning customer and not an error.
 *
 * @example
 * ```ts
 * // app/api/instruments/route.ts
 * import { createInstrument } from '@solvapay/next/helpers'
 *
 * export async function POST(request: Request) {
 *   return createInstrument(request, await request.json())
 * }
 * ```
 */
export async function createInstrument(
  request: globalThis.Request,
  body: {
    handle: string
    captureSessionId: string
    descriptors?: {
      brand?: string
      last4?: string
      expMonth?: number
      expYear?: number
      funding?: string
      issuerCountry?: string
    }
    setAsDefault?: boolean
  },
  options: {
    solvaPay?: SolvaPay
    includeEmail?: boolean
    includeName?: boolean
  } = {},
): Promise<NextResponse> {
  const result = await createInstrumentCore(request, body, options)
  return toNextRouteResponse(result)
}
