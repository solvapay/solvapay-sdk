import { createSolvaPay, createSolvaPayClient } from '@solvapay/server'

export const mcpPublicBaseUrl = process.env.MCP_PUBLIC_BASE_URL || 'http://localhost:3006'
export const solvapayApiBaseUrl = process.env.SOLVAPAY_API_BASE_URL || 'http://localhost:3000'
export const solvapayProductRef = process.env.SOLVAPAY_PRODUCT_REF || ''

/**
 * Origin used when declaring CSP `connectDomains` on the app resource.
 * Browsers require the bare origin (scheme + host + port), so we derive
 * it from the API base URL rather than reusing the full URL.
 */
export const solvapayApiOrigin = new URL(solvapayApiBaseUrl).origin

if (!process.env.SOLVAPAY_SECRET_KEY) {
  throw new Error('SOLVAPAY_SECRET_KEY is required for mcp-checkout-app')
}

if (!solvapayProductRef) {
  throw new Error('SOLVAPAY_PRODUCT_REF is required for mcp-checkout-app')
}

export const solvaPay = createSolvaPay({
  apiClient: createSolvaPayClient({
    apiKey: process.env.SOLVAPAY_SECRET_KEY,
    apiBaseUrl: solvapayApiBaseUrl,
  }),
})
