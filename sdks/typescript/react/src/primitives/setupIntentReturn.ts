/**
 * Helpers for resuming a Stripe card-setup after a 3DS authentication redirect.
 *
 * When `confirmSetup` needs authentication, Stripe redirects the browser to the
 * `return_url` and appends `setup_intent` + `setup_intent_client_secret` query
 * params on the way back. We read the client secret to retrieve the SetupIntent,
 * then strip the params so a manual refresh does not re-trigger the resume.
 */

const SETUP_INTENT_PARAMS = [
  'setup_intent',
  'setup_intent_client_secret',
  'redirect_status',
] as const

/** Read the SetupIntent client secret from a URL query string, if present. */
export function readSetupIntentClientSecret(search: string): string | null {
  return new URLSearchParams(search).get('setup_intent_client_secret')
}

/**
 * Remove the Stripe setup-return params from the current URL without reloading,
 * preserving any unrelated query params. No-op outside the browser.
 */
export function stripSetupIntentParams(): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  let changed = false
  for (const param of SETUP_INTENT_PARAMS) {
    if (url.searchParams.has(param)) {
      url.searchParams.delete(param)
      changed = true
    }
  }
  if (!changed) return
  const query = url.searchParams.toString()
  window.history.replaceState({}, '', `${url.pathname}${query ? `?${query}` : ''}${url.hash}`)
}
