/**
 * Default Content Security Policy allow-list for SolvaPay MCP Apps.
 *
 * The Stripe baseline covers `js.stripe.com`, `api.stripe.com`, and the
 * `hooks.stripe.com` 3DS frame. Adapters merge integrator-provided
 * overrides on top via `mergeCsp`.
 */

import { mcpMergeCsp } from './native-mcp.generated'
import type { SolvaPayMcpCsp } from './types'

let cachedDefaultCsp: Required<SolvaPayMcpCsp> | undefined

function defaultCsp(): Required<SolvaPayMcpCsp> {
  cachedDefaultCsp ??= mcpMergeCsp(undefined, undefined) as Required<SolvaPayMcpCsp>
  return cachedDefaultCsp
}

export const SOLVAPAY_DEFAULT_CSP: Required<SolvaPayMcpCsp> = {
  get resourceDomains() {
    return defaultCsp().resourceDomains
  },
  get connectDomains() {
    return defaultCsp().connectDomains
  },
  get frameDomains() {
    return defaultCsp().frameDomains
  },
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
