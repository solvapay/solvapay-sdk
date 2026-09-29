/**
 * 3DS return for `AutoRecharge.CardSetup`.
 *
 * When saving a card answers `requires_action`, the payer is sent to the
 * rail's `redirectUrl` and comes back to `returnUrl`. The SDK tags that URL
 * with the customer session and vault card id so, on return, it can post
 * the same `cardId` again (the backend finishes the pending setup) and then
 * re-read the auto-recharge config.
 */

export const CARD_SETUP_SESSION_PARAM = 'solvapay_card_setup_session'
export const CARD_SETUP_CARD_PARAM = 'solvapay_card_setup_card'

/** Params the rail may append on the way back; stripped with ours. */
const RAIL_RETURN_PARAMS = ['redirect_status', 'setup_intent', 'setup_intent_client_secret'] as const

export interface CardSetupReturn {
  sessionId: string
  cardId: string
}

/** `href` with the card-setup return params set (replacing any previous ones). */
export function buildCardSetupReturnUrl(href: string, resume: CardSetupReturn): string {
  const url = new URL(href)
  url.searchParams.set(CARD_SETUP_SESSION_PARAM, resume.sessionId)
  url.searchParams.set(CARD_SETUP_CARD_PARAM, resume.cardId)
  return url.toString()
}

/** Read the card-setup return params from a query string, when both are present. */
export function readCardSetupReturn(search: string): CardSetupReturn | undefined {
  const params = new URLSearchParams(search)
  const sessionId = params.get(CARD_SETUP_SESSION_PARAM)
  const cardId = params.get(CARD_SETUP_CARD_PARAM)
  return sessionId && cardId ? { sessionId, cardId } : undefined
}

/** `href` without the card-setup return params (and the rail's own return params). */
export function withoutCardSetupReturnParams(href: string): string {
  const url = new URL(href)
  for (const param of [CARD_SETUP_SESSION_PARAM, CARD_SETUP_CARD_PARAM, ...RAIL_RETURN_PARAMS]) {
    url.searchParams.delete(param)
  }
  return url.toString()
}

/** Remove the return params from the current URL without reloading. No-op outside the browser. */
export function stripCardSetupReturnParams(): void {
  if (typeof window === 'undefined') return
  const next = new URL(withoutCardSetupReturnParams(window.location.href))
  const current = new URL(window.location.href)
  if (next.search === current.search) return
  window.history.replaceState({}, '', `${next.pathname}${next.search}${next.hash}`)
}
