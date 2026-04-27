/**
 * Default Content Security Policy allow-list for SolvaPay MCP Apps.
 *
 * The Stripe baseline covers `js.stripe.com`, `api.stripe.com`, and the
 * `hooks.stripe.com` 3DS frame. Adapters merge integrator-provided
 * overrides on top via `mergeCsp`.
 */

import type { SolvaPayMcpCsp } from './types'

export const SOLVAPAY_DEFAULT_CSP: Required<SolvaPayMcpCsp> = {
  resourceDomains: ['https://js.stripe.com', 'https://*.stripe.com', 'https://b.stripecdn.com'],
  connectDomains: [
    'https://api.stripe.com',
    'https://m.stripe.com',
    'https://r.stripe.com',
    'https://q.stripe.com',
    'https://errors.stripe.com',
  ],
  frameDomains: ['https://js.stripe.com', 'https://hooks.stripe.com'],
}

/**
 * Normalise an absolute URL to its origin (scheme + host + port), with
 * no trailing slash. Returns `undefined` when the input is not a valid
 * absolute URL — callers must treat that as "skip the auto-include"
 * rather than erroring, because CSP is a safety net and a malformed
 * `apiBaseUrl` is already a louder problem elsewhere.
 */
function parseOrigin(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}

/**
 * Merge integrator CSP overrides on top of `SOLVAPAY_DEFAULT_CSP` and
 * (optionally) the configured SolvaPay API origin. Deduplicates per
 * domain list so repeated entries don't balloon the resulting
 * `_meta.ui.csp` envelope.
 *
 * `apiBaseUrl`, when provided, is appended to `resourceDomains` +
 * `connectDomains` so the widget iframe can render merchant branding
 * images (`GET /v1/files/public/...`) and make XHR / fetch calls back
 * to the SolvaPay API without the integrator hand-extending the CSP.
 * Skipped silently when the URL doesn't parse (see `parseOrigin`).
 */
export function mergeCsp(
  overrides: SolvaPayMcpCsp | undefined,
  apiBaseUrl?: string,
): Required<SolvaPayMcpCsp> {
  const apiOrigin = parseOrigin(apiBaseUrl)
  const extraForResource = apiOrigin ? [apiOrigin] : undefined
  const extraForConnect = apiOrigin ? [apiOrigin] : undefined

  const merge = (base: string[], ...extras: Array<string[] | undefined>) => {
    const combined = extras.filter((list): list is string[] => !!list && list.length > 0)
    if (combined.length === 0) return base
    return Array.from(new Set([...base, ...combined.flat()]))
  }

  return {
    resourceDomains: merge(
      SOLVAPAY_DEFAULT_CSP.resourceDomains,
      overrides?.resourceDomains,
      extraForResource,
    ),
    connectDomains: merge(
      SOLVAPAY_DEFAULT_CSP.connectDomains,
      overrides?.connectDomains,
      extraForConnect,
    ),
    frameDomains: merge(SOLVAPAY_DEFAULT_CSP.frameDomains, overrides?.frameDomains),
  }
}
