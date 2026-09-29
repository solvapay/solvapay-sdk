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

/**
 * Save the card the browser captured (`cardId`) on the customer session
 * from {@link createCardSetupGrantCore}. Refuses a session that belongs to
 * another customer. A `requires_action` result carries the 3DS
 * `redirectUrl`; after the payer returns to `returnUrl`, call again with
 * the same `cardId` to finish.
 */
export async function saveCardCore(
  request: Request,
  body: {
    sessionId: string
    cardId: string
    billingDetails?: CardBillingDetails
    returnUrl?: string
  },
  options: { solvaPay?: SolvaPay } = {},
): Promise<SavedCardResult | ErrorResult> {
  try {
    if (!body.sessionId || typeof body.sessionId !== 'string') {
      return { error: 'sessionId is required', status: 400 }
    }
    if (!body.cardId || typeof body.cardId !== 'string') {
      return { error: 'cardId is required', status: 400 }
    }
    if (body.returnUrl !== undefined && (typeof body.returnUrl !== 'string' || !body.returnUrl)) {
      return { error: 'returnUrl must be a non-empty string', status: 400 }
    }
    const customerResult = await syncCustomerCore(request, { solvaPay: options.solvaPay })
    if (isErrorResult(customerResult)) return customerResult

    const solvaPay = options.solvaPay || createSolvaPay()
    const session = await solvaPay.getCustomerSession({ sessionId: body.sessionId })
    if (session.customer?.reference !== customerResult) {
      return { error: 'Customer session not found', status: 404 }
    }
    return await solvaPay.saveCustomerSessionCard({
      sessionId: body.sessionId,
      cardId: body.cardId,
      ...(body.billingDetails ? { billingDetails: body.billingDetails } : {}),
      ...(body.returnUrl ? { returnUrl: body.returnUrl } : {}),
    })
  } catch (error) {
    return handleRouteError(error, 'Save card', 'Card could not be saved')
  }
}
