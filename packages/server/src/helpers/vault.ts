/**
 * Vault Capture Helpers (Core)
 *
 * The host application's side of the card capture flow. Two routes, both of
 * which exist so that the browser never talks to SolvaPay's API with a secret
 * key, and never talks to the vault with anything that outlives one capture.
 *
 * Neither of these ever sees card data. The browser posts the card straight to
 * the vault using the grant minted here; the vault hands back an identifier;
 * the identifier comes back through here to be recorded.
 */

import type { SolvaPay } from '../factory'
import type { ErrorResult } from './types'
import { createSolvaPay } from '../factory'
import { handleRouteError, isErrorResult } from './error'
import { syncCustomerCore } from './customer'

export interface CaptureSessionResult {
  /**
   * Write-only vault access token. Short lived on purpose: re-mint rather than
   * cache, and never store it anywhere on the host application's side.
   */
  token: string
  tenantId: string
  environment: 'sandbox' | 'live'
  /** Epoch milliseconds. */
  expiresAt: number
  /** Send this back with the instrument the capture produced. */
  captureSessionId: string
}

export interface InstrumentDescriptorsInput {
  brand?: string
  last4?: string
  expMonth?: number
  expYear?: number
  /** Nullable, because the browser contract is: the vault does not always say. */
  funding?: string | null
  issuerCountry?: string | null
}

export interface InstrumentResult {
  instrumentRef: string
  /** True when this card was already on file. Not an error. */
  existing: boolean
}

/**
 * Mints a capture grant for the signed-in customer.
 *
 * The customer is resolved from the request's own session, never from the
 * request body. A caller cannot ask for a grant on somebody else's behalf by
 * naming them, which is the whole reason this route exists rather than the
 * browser calling SolvaPay directly.
 */
export async function createCaptureSessionCore(
  request: Request,
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
): Promise<CaptureSessionResult | ErrorResult> {
  try {
    const customerResult = await syncCustomerCore(request, {
      solvaPay: options.solvaPay,
      includeEmail: options.includeEmail,
      includeName: options.includeName,
    })

    if (isErrorResult(customerResult)) {
      return customerResult
    }

    const solvaPay = options.solvaPay || createSolvaPay()

    if (!solvaPay.createCaptureSession) {
      return {
        error: 'This SolvaPay client does not support vault capture',
        status: 501,
      }
    }

    return await solvaPay.createCaptureSession({
      customerRef: customerResult,
      // Refs are forwarded, not dropped. They were declared on this signature
      // and silently discarded, so a host scoping the surface with a productRef
      // got a grant with no product scope and no way to tell.
      ...(body.productRef ? { productRef: body.productRef } : {}),
      ...(body.planRef ? { planRef: body.planRef } : {}),
      ...(body.checkoutSessionId ? { checkoutSessionId: body.checkoutSessionId } : {}),
    })
  } catch (error) {
    return handleRouteError(error, 'Create capture session', 'Capture session creation failed')
  }
}

/**
 * Records a instrument the vault has already stored.
 *
 * Takes the vault's identifier for the card and the descriptors it reported.
 * Nothing here is card data: the longest value is four trailing digits.
 *
 * A card already on file comes back with `existing: true` and the reference it
 * already had. That is the normal path for a returning customer re-entering the
 * same card, and callers should treat it as success, not as a conflict.
 */
export async function createInstrumentCore(
  request: Request,
  body: {
    handle: string
    captureSessionId: string
    descriptors?: InstrumentDescriptorsInput
    setAsDefault?: boolean
  },
  options: {
    solvaPay?: SolvaPay
    includeEmail?: boolean
    includeName?: boolean
  } = {},
): Promise<InstrumentResult | ErrorResult> {
  try {
    if (!body?.handle) {
      return { error: 'Missing required parameter: handle is required', status: 400 }
    }
    if (!body?.captureSessionId) {
      return {
        error: 'Missing required parameter: captureSessionId is required',
        status: 400,
      }
    }

    const customerResult = await syncCustomerCore(request, {
      solvaPay: options.solvaPay,
      includeEmail: options.includeEmail,
      includeName: options.includeName,
    })

    if (isErrorResult(customerResult)) {
      return customerResult
    }

    const solvaPay = options.solvaPay || createSolvaPay()

    if (!solvaPay.createInstrument) {
      return {
        error: 'This SolvaPay client does not support vault capture',
        status: 501,
      }
    }

    // Named fields only. Forwarding the caller's object wholesale is how a
    // field nobody intended to send ends up being stored, and the one thing
    // that must never reach the database here is anything off the card.
    const descriptors = body.descriptors ?? {}

    return await solvaPay.createInstrument({
      handle: body.handle,
      captureSessionId: body.captureSessionId,
      customerRef: customerResult,
      ...(body.setAsDefault === undefined ? {} : { setAsDefault: body.setAsDefault }),
      descriptors: {
        ...(descriptors.brand === undefined ? {} : { brand: descriptors.brand }),
        ...(descriptors.last4 === undefined ? {} : { last4: descriptors.last4 }),
        ...(descriptors.expMonth === undefined ? {} : { expMonth: descriptors.expMonth }),
        ...(descriptors.expYear === undefined ? {} : { expYear: descriptors.expYear }),
        // `== null` on purpose: the browser contract types these nullable and
        // sends an explicit null when the vault did not report them, which the
        // platform's schema does not accept as a string.
        ...(descriptors.funding == null ? {} : { funding: descriptors.funding }),
        ...(descriptors.issuerCountry == null ? {} : { issuerCountry: descriptors.issuerCountry }),
      },
    })
  } catch (error) {
    return handleRouteError(error, 'Create instrument', 'Instrument creation failed')
  }
}
