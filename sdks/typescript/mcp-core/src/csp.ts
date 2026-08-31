/**
 * Default Content Security Policy allow-list for SolvaPay MCP Apps.
 *
 * The Stripe baseline covers `js.stripe.com`, `api.stripe.com`, and the
 * `hooks.stripe.com` 3DS frame. Adapters merge integrator-provided
 * overrides on top via `mergeCsp`.
 */

import { mcpMergeCsp } from './native-mcp.generated'
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
 * Merge integrator CSP overrides on top of `SOLVAPAY_DEFAULT_CSP` and
 * (optionally) the configured SolvaPay API origin. Deduplicates per
 * domain list so repeated entries don't balloon the resulting
 * `_meta.ui.csp` envelope.
 *
 * `apiBaseUrl`, when provided, is appended to `resourceDomains` +
 * `connectDomains` so the widget iframe can render merchant branding
 * images (`GET /v1/files/public/...`) and make XHR / fetch calls back
 * to the SolvaPay API without the integrator hand-extending the CSP.
 * Invalid `apiBaseUrl` values are skipped by the Rust op.
 */
export function mergeCsp(
  overrides: SolvaPayMcpCsp | undefined,
  apiBaseUrl?: string,
): Required<SolvaPayMcpCsp> {
  return mcpMergeCsp(overrides, apiBaseUrl) as Required<SolvaPayMcpCsp>
}
