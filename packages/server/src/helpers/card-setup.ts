/**
 * Card setup helpers (core): save a card without paying.
 *
 * The browser captures the card into the vault under a grant scoped to a
 * customer session, then the server saves it on that session. Used by
 * `AutoRecharge.CardSetup` when a config has no card on file yet.
 */

import type { SolvaPay } from '../factory'
import type { ErrorResult } from './types'
import type { CaptureGrant, CardBillingDetails, SavedCardResult } from '../types/client'
import { createSolvaPay } from '../factory'
import { handleRouteError, isErrorResult } from './error'
import { syncCustomerCore } from './customer'

/**
 * Open a customer session for the authenticated customer and issue one
 * short-lived vault grant on it. The grant's `scope.sessionId` is what
 * {@link saveCardCore} takes back once the card is captured.
 */
export async function createCardSetupGrantCore(
  request: Request,
  options: { solvaPay?: SolvaPay } = {},
): Promise<CaptureGrant | ErrorResult> {
  try {
    const customerResult = await syncCustomerCore(request, { solvaPay: options.solvaPay })
    if (isErrorResult(customerResult)) return customerResult

    const solvaPay = options.solvaPay || createSolvaPay()
    const session = await solvaPay.createCustomerSession({ customerRef: customerResult })
    return await solvaPay.createCustomerSessionCaptureGrant({ sessionId: session.sessionId })
  } catch (error) {
    return handleRouteError(error, 'Create card setup grant', 'Could not start card setup')
  }
}

/** The body of a save-card request: a captured card, or the completion of a pending setup. */
export type SaveCardBody =
  | {
      sessionId: string
      cardId: string
      billingDetails?: CardBillingDetails
      /** Where the rail sends the payer back after 3DS; the integrator's page. */
      returnUrl: string
    }
  | {
      sessionId: string
      /** The payer is back from 3DS: finish the setup the session keeps. */
      completePendingSetup: true
    }

/**
 * Validate a save-card body as it arrives from the browser: exactly one of
 * `cardId` (with `returnUrl`) or `completePendingSetup: true`, on a
 * `sessionId`. Returns the body to send, or the 400 to answer.
 */
export function parseSaveCardBody(body: unknown): SaveCardBody | ErrorResult {
  const b = (body ?? {}) as Record<string, unknown>
  if (!b.sessionId || typeof b.sessionId !== 'string') {
    return { error: 'sessionId is required', status: 400 }
  }
  const hasCard = b.cardId !== undefined
  const completing = b.completePendingSetup !== undefined
  if (hasCard === completing) {
    return { error: 'Provide exactly one of cardId or completePendingSetup', status: 400 }
  }
  if (completing) {
    if (b.completePendingSetup !== true) {
      return { error: 'completePendingSetup must be true', status: 400 }
    }
    return { sessionId: b.sessionId, completePendingSetup: true }
  }
  if (!b.cardId || typeof b.cardId !== 'string') {
    return { error: 'cardId is required', status: 400 }
  }
  if (!b.returnUrl || typeof b.returnUrl !== 'string') {
    return { error: 'returnUrl is required', status: 400 }
  }
  return {
    sessionId: b.sessionId,
    cardId: b.cardId,
    returnUrl: b.returnUrl,
    ...(b.billingDetails ? { billingDetails: b.billingDetails as CardBillingDetails } : {}),
  }
}

/**
 * Save the card the browser captured (`cardId`) on the customer session
 * from {@link createCardSetupGrantCore}, or complete the setup the payer
 * just authenticated (`completePendingSetup: true`). Refuses a session that
 * belongs to another customer. A `requires_action` result carries the 3DS
 * `redirectUrl`; the payer comes back to `returnUrl`, and the page then
 * calls again with `{ sessionId, completePendingSetup: true }`.
 */
export async function saveCardCore(
  request: Request,
  body: SaveCardBody | Record<string, unknown>,
  options: { solvaPay?: SolvaPay } = {},
): Promise<SavedCardResult | ErrorResult> {
  try {
    const parsed = parseSaveCardBody(body)
    if (isErrorResult(parsed)) return parsed
    const customerResult = await syncCustomerCore(request, { solvaPay: options.solvaPay })
    if (isErrorResult(customerResult)) return customerResult

    const solvaPay = options.solvaPay || createSolvaPay()
    const session = await solvaPay.getCustomerSession({ sessionId: parsed.sessionId })
    if (session.customer?.reference !== customerResult) {
      return { error: 'Customer session not found', status: 404 }
    }
    return await solvaPay.saveCustomerSessionCard(parsed)
  } catch (error) {
    return handleRouteError(error, 'Save card', 'Card could not be saved')
  }
}
