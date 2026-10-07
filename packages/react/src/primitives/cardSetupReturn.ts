/**
 * 3DS return for `AutoRecharge.CardSetup`.
 *
 * When saving a card answers `requires_action`, the payer is sent to the
 * rail's `redirectUrl` and comes back to `returnUrl`. The SDK tags that URL
 * with the customer session so, on return, it can complete the pending
 * setup the session keeps (`{ sessionId, completePendingSetup: true }`) and
 * then re-read the auto-recharge config. The card itself is not carried in
 * the URL: the backend recorded it on the session before the redirect.
 */

export const CARD_SETUP_SESSION_PARAM = 'solvapay_card_setup_session'

/** Params the rail may append on the way back; stripped with ours. */
const RAIL_RETURN_PARAMS = [
  'redirect_status',
  'setup_intent',
  'setup_intent_client_secret',
] as const

export interface CardSetupReturn {
  sessionId: string
}

/** `href` with the card-setup return param set (replacing any previous one). */
export function buildCardSetupReturnUrl(href: string, resume: CardSetupReturn): string {
  const url = new URL(href)
  url.searchParams.set(CARD_SETUP_SESSION_PARAM, resume.sessionId)
  return url.toString()
}

/** Read the card-setup return param from a query string, when present. */
export function readCardSetupReturn(search: string): CardSetupReturn | undefined {
  const sessionId = new URLSearchParams(search).get(CARD_SETUP_SESSION_PARAM)
  return sessionId ? { sessionId } : undefined
}

/** `href` without the card-setup return param (and the rail's own return params). */
export function withoutCardSetupReturnParams(href: string): string {
  const url = new URL(href)
  for (const param of [CARD_SETUP_SESSION_PARAM, ...RAIL_RETURN_PARAMS]) {
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
