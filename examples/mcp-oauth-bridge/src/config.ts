import { createSolvaPay, createSolvaPayClient } from '@solvapay/server'

const apiClient = createSolvaPayClient({
  apiKey: process.env.SOLVAPAY_SECRET_KEY!,
  apiBaseUrl: process.env.SOLVAPAY_API_BASE_URL,
})

export const solvapayProductRef = process.env.SOLVAPAY_PRODUCT_REF!

export const solvaPay = createSolvaPay({
  apiClient,
})

export const payable = solvaPay.payable({
  product: solvapayProductRef,
})

export const paywallEnabled = process.env.PAYWALL_ENABLED !== 'false'

export const mcpPublicBaseUrl = process.env.MCP_PUBLIC_BASE_URL || 'http://localhost:3004'
export const oauthBaseUrl = process.env.SOLVAPAY_OAUTH_BASE_URL || 'http://localhost:3000'
