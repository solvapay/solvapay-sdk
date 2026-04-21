/**
 * Default Content Security Policy allow-list for SolvaPay MCP Apps.
 *
 * The Stripe baseline covers `js.stripe.com`, `api.stripe.com`, and the
 * `hooks.stripe.com` 3DS frame. Adapters merge integrator-provided
 * overrides on top via `mergeCsp`.
 */

import type { SolvaPayMcpCsp } from './types'

export const SOLVAPAY_DEFAULT_CSP: Required<SolvaPayMcpCsp> = {
  resourceDomains: [
    'https://js.stripe.com',
    'https://*.stripe.com',
    'https://b.stripecdn.com',
  ],
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
 * Merge integrator CSP overrides on top of `SOLVAPAY_DEFAULT_CSP`.
 * Deduplicates per domain list so repeated entries don't balloon the
 * resulting `_meta.ui.csp` envelope.
 */
export function mergeCsp(overrides: SolvaPayMcpCsp | undefined): Required<SolvaPayMcpCsp> {
  if (!overrides) return SOLVAPAY_DEFAULT_CSP
  const merge = (base: string[], extra?: string[]) =>
    extra && extra.length ? Array.from(new Set([...base, ...extra])) : base
  return {
    resourceDomains: merge(SOLVAPAY_DEFAULT_CSP.resourceDomains, overrides.resourceDomains),
    connectDomains: merge(SOLVAPAY_DEFAULT_CSP.connectDomains, overrides.connectDomains),
    frameDomains: merge(SOLVAPAY_DEFAULT_CSP.frameDomains, overrides.frameDomains),
  }
}
