import { createSolvaPay, createSolvaPayClient } from '@solvapay/server'
import { createStubClient } from '../../shared/stub-api-client'

export const port = parseInt(process.env.MCP_PORT || '3006', 10)
export const host = process.env.MCP_HOST || '127.0.0.1'
export const mcpPublicBaseUrl = process.env.MCP_PUBLIC_BASE_URL || `http://localhost:${port}`
export const solvapayApiBaseUrl = process.env.SOLVAPAY_API_BASE_URL || 'http://localhost:3010'
export const stubMode = process.env.SOLVAPAY_STUB === '1'
export const solvapayProductRef =
  process.env.SOLVAPAY_PRODUCT_REF || (stubMode ? 'prd_stub_demo' : '')

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
  .map(entry => entry.trim())
  .filter(Boolean)

if (!stubMode && !solvapayProductRef) {
  throw new Error('SOLVAPAY_PRODUCT_REF is required for mcp-checkout-app')
}

export const solvaPay = (() => {
  if (stubMode) {
    return createSolvaPay({
      apiClient: createStubClient({
        freeTierLimit: 3,
        debug: true,
      }),
      limitsCacheTTL: 0,
    })
  }
  const secretKey = process.env.SOLVAPAY_SECRET_KEY
  if (!secretKey) {
    throw new Error('SOLVAPAY_SECRET_KEY is required for mcp-checkout-app')
  }
  return createSolvaPay({
    apiClient: createSolvaPayClient({
      apiKey: secretKey,
      apiBaseUrl: solvapayApiBaseUrl,
    }),
  })
})()

if (stubMode) {
  console.warn(
    '[mcp-checkout-app] SOLVAPAY_STUB=1: using the in-process stub client. No real charges occur.',
  )
}
