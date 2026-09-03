import { createSolvaPay, createSolvaPayClient } from '@solvapay/server'
import { createStubClient } from '../../shared/stub-api-client'

export const port = parseInt(process.env.MCP_PORT || '3006', 10)
export const host = process.env.MCP_HOST || 'localhost'
export const mcpPublicBaseUrl = process.env.MCP_PUBLIC_BASE_URL || `http://localhost:${port}`
export const solvapayApiBaseUrl = process.env.SOLVAPAY_API_BASE_URL || 'http://localhost:3000'

/**
 * Explicit offline mode. When `SOLVAPAY_STUB=1`, the example uses
 * `createStubClient` and does not charge. When the flag is unset the
 * existing required-env throws stay exactly as they are — this is not
 * a silent degrade.
 */
export const stubMode = process.env.SOLVAPAY_STUB === '1'

const STUB_PRODUCT_REF = 'prd_stub'

export const solvapayProductRef = stubMode
  ? process.env.SOLVAPAY_PRODUCT_REF || STUB_PRODUCT_REF
  : process.env.SOLVAPAY_PRODUCT_REF || ''

/**
 * Origin used when declaring CSP `connectDomains` on the app resource.
 * Browsers require the bare origin (scheme + host + port), so we derive
 * it from the API base URL rather than reusing the full URL.
 */
export const solvapayApiOrigin = new URL(solvapayApiBaseUrl).origin

/**
 * Extra origins the iframe is allowed to load *resources* (img / style
 * / font) from. Merged into the CSP's `resource_domains`.
 *
 * Typical values in local dev:
 *   MCP_ASSET_ORIGINS=http://localhost:6274,http://localhost:3001
 *
 * The backend admin serves provider-uploaded logos over
 * `http://localhost:<port>/ui/files/download/...` in dev, so the
 * merchant logo from `BootstrapPayload.merchant.logoUrl` would be
 * blocked by the CSP's default (Stripe-only) `img-src` without this
 * opt-in.
 *
 * Leave unset in production — the default CSP is tight on purpose so
 * you don't accidentally widen it beyond Stripe.
 */
export const mcpAssetOrigins = (process.env.MCP_ASSET_ORIGINS ?? '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean)

function createLiveSolvaPay() {
  const apiKey = process.env.SOLVAPAY_SECRET_KEY
  if (!apiKey) {
    throw new Error('SOLVAPAY_SECRET_KEY is required for mcp-checkout-app')
  }
  if (!solvapayProductRef) {
    throw new Error('SOLVAPAY_PRODUCT_REF is required for mcp-checkout-app')
  }
  return createSolvaPay({
    apiClient: createSolvaPayClient({
      apiKey,
      apiBaseUrl: solvapayApiBaseUrl,
    }),
  })
}

if (stubMode) {
  console.error(
    '[mcp-checkout-app] SOLVAPAY_STUB=1 — using the stub API client. No real charges occur.',
  )
}

export const solvaPay = stubMode
  ? createSolvaPay({
      apiClient: createStubClient({
        freeTierLimit: 3,
        startAtIncludedCap: true,
        debug: process.env.STUB_DEBUG !== 'false',
        delays: { checkLimits: 0, trackUsage: 0, customer: 0 },
      }),
      limitsCacheTTL: 0,
    })
  : createLiveSolvaPay()
